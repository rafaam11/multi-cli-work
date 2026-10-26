import type { MultiCliWorkApi } from "@shared/api-types";
import type { RepoResult, WorkProjectRepoSync } from "@shared/repo-sync-types";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { repoStatus, repoSyncNoticeToast, WorkProjectRepoSyncCard } from "./WorkProjectRepoSyncCard";

afterEach(cleanup);

const AT = "2026-10-26T00:00:00.000Z";

function result(patch: Partial<RepoResult>): RepoResult {
  return { path: "D:\\dev\\alpha", status: "up-to-date", finishedAt: AT, cached: false, ...patch };
}

function sync(results: RepoResult[], pending: string[] = [], source: WorkProjectRepoSync["source"] = "fallback"): WorkProjectRepoSync {
  return { source, report: { schemaVersion: 1, startedAt: AT, finishedAt: AT, results, pending, summary: "" } };
}

describe("repoStatus", () => {
  it("상태마다 HM 라벨표 문구로 보여 준다", () => {
    expect(repoStatus(result({ status: "updated", commits: 2 }))).toEqual({ text: "최신화됨 (2커밋)", tone: "ok" });
    expect(repoStatus(result({}))).toEqual({ text: "이미 최신", tone: "quiet" });
    expect(repoStatus(result({ ahead: 1 })).text).toBe("이미 최신 · 로컬이 1커밋 앞섬");
    expect(repoStatus(result({ status: "skipped", reason: "dirty" }))).toEqual({ text: "건너뜀 · 로컬 변경", tone: "warn" });
    expect(repoStatus(result({ status: "skipped", reason: "diverged" })).text).toBe("건너뜀 · 로컬과 원격이 갈라짐");
    expect(repoStatus(result({ status: "failed", failKind: "auth" }))).toEqual({ text: "실패 · 인증 실패", tone: "danger" });
  });
});

describe("repoSyncNoticeToast", () => {
  const base = { workProjectId: "wp-1", label: "VSP", sessionId: "s-1" };

  it("건너뜀만 있으면 경고, 실패가 섞이면 오류로 레포와 사유를 나열한다", () => {
    const onSelect = vi.fn();
    expect(repoSyncNoticeToast({ ...base, skipped: [{ name: "beta", reason: "로컬 변경" }], failed: [] }, onSelect)).toEqual({
      tone: "warning",
      title: "VSP 레포 최신화: 1개 건너뜀",
      detail: "beta(로컬 변경)",
      onSelect,
    });
    expect(
      repoSyncNoticeToast(
        { ...base, skipped: [{ name: "beta", reason: "로컬 변경" }], failed: [{ name: "gamma", reason: "인증 실패" }] },
        onSelect,
      ),
    ).toMatchObject({ tone: "error", title: "VSP 레포 최신화: 1개 실패, 1개 건너뜀", detail: "gamma(인증 실패), beta(로컬 변경)" });
  });
});

describe("WorkProjectRepoSyncCard", () => {
  it("마지막 기록을 레포별로 보여 주고, 버튼은 실행 중에 잠갔다가 결과로 바꾼다", async () => {
    let finish!: (value: WorkProjectRepoSync) => void;
    const lastRepoSync = vi.fn().mockResolvedValue(sync([result({ status: "skipped", reason: "dirty" })], ["D:\\dev\\beta"]));
    const syncRepos = vi.fn(() => new Promise<WorkProjectRepoSync>((resolve) => (finish = resolve)));
    window.multiCliWork = { workProjects: { lastRepoSync, syncRepos } } as unknown as MultiCliWorkApi;

    render(<WorkProjectRepoSyncCard workProjectId="wp-1" />);
    expect(await screen.findByText("건너뜀 · 로컬 변경")).toBeTruthy();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getByText("기록 없음")).toBeTruthy();
    expect(lastRepoSync).toHaveBeenCalledWith("wp-1");

    const button = screen.getByRole("button", { name: "모든 레포 최신화" }) as HTMLButtonElement;
    fireEvent.click(button);
    await waitFor(() => expect(button.disabled).toBe(true));
    expect(syncRepos).toHaveBeenCalledWith("wp-1");

    finish(sync([result({ status: "updated", commits: 3 }), result({ path: "D:\\dev\\beta", status: "failed", failKind: "network", error: "Could not resolve host" })], [], "hm"));
    expect(await screen.findByText("최신화됨 (3커밋)")).toBeTruthy();
    expect(screen.getByText("실패 · 네트워크 오류").getAttribute("title")).toBe("Could not resolve host");
    expect(screen.getByText(/Harness Manager/)).toBeTruthy();
    expect(button.disabled).toBe(false);
  });

  it("레포가 없는 업무 프로젝트는 빈 안내를 보여 준다", async () => {
    window.multiCliWork = {
      workProjects: { lastRepoSync: vi.fn().mockResolvedValue(null), syncRepos: vi.fn() },
    } as unknown as MultiCliWorkApi;
    render(<WorkProjectRepoSyncCard workProjectId="wp-1" />);
    expect(await screen.findByText("레포 멤버나 연결된 셸의 레포가 없습니다.")).toBeTruthy();
  });
});
