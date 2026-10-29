// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoSyncReport } from "../../shared/repo-sync-types";
import type { GitRunner } from "./engine/git";
import { startRepoSync } from "./engine/runner";
import { createRemoteFixture, type RemoteFixture } from "./engine/test-fixtures";
import type { HmCli } from "./hm-cli";
import { createRepoSyncService } from "./repo-sync-service";

// mcw: 실제 git을 여러 번 부른다. 전체 스위트가 병렬로 돌 때 5초 기본값을 넘긴다.
vi.setConfig({ testTimeout: 30_000 });

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-repo-sync-service-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const CLI: HmCli = { command: "hm.exe", args: [], env: {} };

function report(paths: string[]): RepoSyncReport {
  return {
    schemaVersion: 1,
    startedAt: "2026-10-26T00:00:00.000Z",
    finishedAt: "2026-10-26T00:00:01.000Z",
    results: paths.map((p) => ({ path: p, status: "up-to-date", finishedAt: "2026-10-26T00:00:01.000Z", cached: false })),
    pending: [],
    summary: "요약",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const target = { label: "VSP", paths: ["D:\\dev\\a", "D:\\dev\\b"] };

describe("createRepoSyncService", () => {
  it("HM CLI가 있으면 경로·라벨·force·waitMs를 넘겨 부르고, 동시에 온 호출은 한 번으로 묶는다", async () => {
    const gate = deferred<RepoSyncReport | null>();
    const runCli = vi.fn(() => gate.promise);
    const service = createRepoSyncService({ resolve: async () => target, root, findCli: async () => CLI, runCli });

    const first = service.sync("wp", { force: false, waitMs: 3000 });
    const second = service.sync("wp", { force: false, waitMs: 3000 });
    await vi.waitFor(() => expect(runCli).toHaveBeenCalledTimes(1));
    gate.resolve(report(target.paths));

    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual({ report: report(target.paths), source: "hm" });
    expect(b).toBe(a);
    expect(runCli).toHaveBeenCalledWith(CLI, { paths: target.paths, label: "VSP", force: false, waitMs: 3000 }, 3500);
  });

  it("버튼(force)은 진행 중인 쿨다운 실행을 기다린 뒤 다시 돈다", async () => {
    const gate = deferred<RepoSyncReport | null>();
    const runCli = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(report(target.paths));
    const service = createRepoSyncService({ resolve: async () => target, root, findCli: async () => CLI, runCli });

    const auto = service.sync("wp", { force: false, waitMs: 3000 });
    const manual = service.sync("wp", { force: true });
    await vi.waitFor(() => expect(runCli).toHaveBeenCalledTimes(1));
    gate.resolve(report(target.paths));
    await Promise.all([auto, manual]);

    expect(runCli).toHaveBeenCalledTimes(2);
    expect(runCli.mock.calls[1]?.[1]).toEqual({ paths: target.paths, label: "VSP", force: true });
    expect(runCli.mock.calls[1]?.[2]).toBe(180_000);
  });

  it("HM이 답하지 않으면 대체 구현으로 내려가지 않고 마지막 기록을 보여 준다", async () => {
    const startFallback = vi.fn(startRepoSync);
    const service = createRepoSyncService({
      resolve: async () => target,
      root,
      findCli: async () => CLI,
      runCli: async () => null,
      startFallback,
    });
    const result = await service.sync("wp", { force: false, waitMs: 3000 });
    expect(startFallback).not.toHaveBeenCalled();
    expect(result?.source).toBe("hm");
    // 기록 조회는 경로를 path.resolve한 원형으로 돌려준다 — posix에서는 Windows 경로가 cwd 아래로 풀린다.
    expect(result?.report.pending).toEqual(target.paths.map((candidate) => path.resolve(candidate)));
  });

  it("레포가 없는 업무 프로젝트는 아무것도 돌리지 않는다", async () => {
    const runCli = vi.fn();
    const service = createRepoSyncService({ resolve: async () => ({ label: "x", paths: [] }), root, findCli: async () => CLI, runCli });
    expect(await service.sync("wp", { force: true })).toBeNull();
    expect(runCli).not.toHaveBeenCalled();
  });
});

describe("createRepoSyncService — HM이 없는 PC(실제 git)", () => {
  let fx: RemoteFixture;

  beforeEach(() => {
    fx = createRemoteFixture();
  });

  afterEach(() => {
    fx.cleanup();
  });

  it("대체 구현으로 최신화하고 state.json을 HM과 같은 자리에 남긴다", async () => {
    fx.pushFromOther(1);
    const service = createRepoSyncService({
      resolve: async () => ({ label: "VSP", paths: [fx.work] }),
      root,
      findCli: async () => null,
      startFallback: (options) => startRepoSync({ ...options, cloudRoots: [] }),
    });

    const result = await service.sync("wp", { force: true });
    expect(result?.source).toBe("fallback");
    expect(result?.report.results).toMatchObject([{ status: "updated", commits: 1, cached: false }]);
    expect(result?.report.summary).toContain("최신화");

    const last = await service.last("wp");
    expect(last?.report.results).toMatchObject([{ status: "updated", cached: true }]);
    await expect(fs.access(path.join(root, "repo-sync", "state.json"))).resolves.toBeUndefined();
  });

  it("waitMs 안에 끝나지 않은 레포는 pending으로 돌려주고 뒤에서 마저 끝낸다", async () => {
    const slowGit: GitRunner = async (cwd, args, timeoutMs) => {
      if (args.includes("fetch")) await new Promise((r) => setTimeout(r, 600));
      const { runGit } = await import("./engine/git");
      return runGit(cwd, args, timeoutMs);
    };
    const service = createRepoSyncService({
      resolve: async () => ({ label: "VSP", paths: [fx.work] }),
      root,
      findCli: async () => null,
      startFallback: (options) => startRepoSync({ ...options, git: slowGit, cloudRoots: [] }),
    });

    const early = await service.sync("wp", { force: false, waitMs: 50 });
    expect(early?.report.pending).toEqual([path.resolve(fx.work)]);
    expect(early?.report.summary).toContain("진행 중");
    await vi.waitFor(async () => expect((await service.last("wp"))?.report.pending).toEqual([]), { timeout: 10_000 });
  });
});
