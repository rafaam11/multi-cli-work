// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { RepoResult, RepoSyncReport } from "../../shared/repo-sync-types";
import { createNoticeGate, sessionNotice } from "./repo-sync-notice";

const AT = "2026-10-26T00:00:00.000Z";

function report(results: Partial<RepoResult>[], pending: string[] = []): RepoSyncReport {
  return {
    schemaVersion: 1,
    label: "VSP",
    startedAt: AT,
    finishedAt: AT,
    results: results.map((patch) => ({ path: "D:\\dev\\alpha", status: "up-to-date", finishedAt: AT, cached: false, ...patch })),
    pending,
    summary: "",
  };
}

describe("sessionNotice", () => {
  it("건너뜀·실패 레포를 이름과 라벨표 사유로 모은다", () => {
    const notice = sessionNotice(
      "wp-1",
      "s-1",
      report([
        { path: "D:\\dev\\alpha", status: "updated", commits: 1 },
        { path: "D:\\dev\\beta", status: "skipped", reason: "dirty" },
        { path: "C:\\NeuroPilot\\gamma\\", status: "failed", failKind: "auth" },
      ]),
    );
    expect(notice).toEqual({
      workProjectId: "wp-1",
      label: "VSP",
      sessionId: "s-1",
      skipped: [{ name: "beta", reason: "로컬 변경" }],
      failed: [{ name: "gamma", reason: "인증 실패" }],
    });
  });

  it("모두 최신이거나 아직 도는 레포뿐이면 알리지 않는다", () => {
    expect(sessionNotice("wp-1", "s-1", report([{ status: "updated" }, { status: "up-to-date" }], ["D:\\dev\\slow"]))).toBeNull();
  });
});

describe("createNoticeGate", () => {
  const notice = sessionNotice("wp-1", "s-1", report([{ path: "D:\\dev\\beta", status: "skipped", reason: "dirty" }]))!;

  it("같은 업무 프로젝트의 같은 알림은 기간 안에 한 번만 통과시킨다", () => {
    const gate = createNoticeGate(1000);
    expect(gate(notice, 0)).toBe(true);
    expect(gate({ ...notice, sessionId: "s-2" }, 10)).toBe(false);
    expect(gate(notice, 1000)).toBe(true);
  });

  it("내용이 바뀌거나 다른 업무 프로젝트면 바로 알린다", () => {
    const gate = createNoticeGate(1000);
    expect(gate(notice, 0)).toBe(true);
    expect(gate({ ...notice, failed: [{ name: "gamma", reason: "인증 실패" }] }, 1)).toBe(true);
    expect(gate({ ...notice, workProjectId: "wp-2" }, 2)).toBe(true);
  });
});
