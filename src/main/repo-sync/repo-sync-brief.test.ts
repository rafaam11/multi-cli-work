// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { WorkProjectRepoSync } from "../../shared/repo-sync-types";
import { repoSyncForSession } from "./repo-sync-brief";
import type { RepoSyncService } from "./repo-sync-service";

function service(sync: RepoSyncService["sync"]): RepoSyncService {
  return { sync, last: vi.fn() };
}

const result: WorkProjectRepoSync = {
  source: "fallback",
  report: {
    schemaVersion: 1,
    startedAt: "2026-10-26T00:00:00.000Z",
    finishedAt: "2026-10-26T00:00:03.000Z",
    results: [],
    pending: ["D:\\dev\\a"],
    summary: "레포 1개 중 1개 진행 중\n- 진행 중: a",
  },
};

describe("repoSyncForSession", () => {
  it("세션 시작은 쿨다운을 지키고 3초만 기다리라고 부른 뒤, 요약 절과 보고서를 함께 돌려준다", async () => {
    const sync = vi.fn(async () => result);
    expect(await repoSyncForSession(service(sync), "wp")).toEqual({
      section: "## 레포 최신화 (세션 시작 시점)\n\n레포 1개 중 1개 진행 중\n- 진행 중: a\n",
      report: result.report,
    });
    expect(sync).toHaveBeenCalledWith("wp", { force: false, waitMs: 3000 });
  });

  it("실패하거나, 레포가 없거나, 상한 안에 답이 없으면 빈 결과로 세션을 막지 않는다", async () => {
    const empty = { section: null, report: null };
    expect(await repoSyncForSession(service(async () => Promise.reject(new Error("boom"))), "wp")).toEqual(empty);
    expect(await repoSyncForSession(service(async () => null), "wp")).toEqual(empty);
    const started = Date.now();
    expect(await repoSyncForSession(service(() => new Promise(() => undefined)), "wp", 100)).toEqual(empty);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
