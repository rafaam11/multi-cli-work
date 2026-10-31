// @vitest-environment node
// 출처: harness-manager src/main/services/repo-sync/runner.test.ts — 계약 harness-manager docs/contracts/repo-sync.md.
// HM이 없는 PC의 대체 구현이다. 판정 순서·잠금·state.json이 HM과 같아야 하므로 HM 쪽이 바뀌면 같이 고친다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import lockfile from "proper-lockfile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitRunner } from "./git";
import { repoSyncKey } from "./paths";
import { lastRepoSyncReport, lockTarget, startRepoSync, syncRepos } from "./runner";
import { readRepoSyncState, recordRepoResult } from "./state";

// mcw: 실제 git을 여러 번 부른다. 전체 스위트가 병렬로 돌 때 5초 기본값을 넘긴다.
vi.setConfig({ testTimeout: 30_000 });

let root: string;
let stateDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hm-repo-runner-"));
  stateDir = path.join(root, "state");
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function repoDirs(count: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const dir = path.join(root, `repo-${index}`);
    fs.mkdirSync(dir);
    return dir;
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 깨끗하고 이미 최신인 레포처럼 답하는 가짜 git. fetch만 느리게 할 수 있다. */
function fakeGit(fetchDelay: (cwd: string) => number = () => 0) {
  const stats = { fetches: 0, active: 0, maxActive: 0 };
  const run: GitRunner = async (cwd, args) => {
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return `${cwd}\n`;
    if (args[0] === "rev-parse" && args[1] === "--absolute-git-dir") return `${path.join(cwd, ".git")}\n`;
    if (args[0] === "status") return ["# branch.head main", "# branch.upstream origin/main", "# branch.ab +0 -0", ""].join("\0");
    if (args[0] === "fetch") {
      stats.fetches += 1;
      stats.active += 1;
      stats.maxActive = Math.max(stats.maxActive, stats.active);
      await sleep(fetchDelay(cwd));
      stats.active -= 1;
      return "";
    }
    if (args[0] === "rev-list") return "0\t0\n";
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { run, stats };
}

describe("startRepoSync", () => {
  it("쿨다운 안의 성공 결과는 git을 다시 돌리지 않고 재사용하고, force면 다시 돈다", async () => {
    const [repo] = repoDirs(1);
    const { run, stats } = fakeGit();
    const base = { paths: [repo!], stateDir, git: run, cloudRoots: [] };

    const first = await syncRepos(base);
    expect(first.results[0]).toMatchObject({ status: "up-to-date", cached: false });
    const second = await syncRepos(base);
    expect(second.results[0]).toMatchObject({ status: "up-to-date", cached: true });
    expect(stats.fetches).toBe(1);

    await syncRepos({ ...base, force: true });
    expect(stats.fetches).toBe(2);

    // 쿨다운이 지나면 다시 돈다.
    const later = () => new Date(Date.now() + 11 * 60_000);
    await syncRepos({ ...base, now: later });
    expect(stats.fetches).toBe(3);
  });

  it("실패와 건너뜀은 쿨다운 없이 다음에 다시 시도한다", async () => {
    const missing = path.join(root, "not-there");
    await syncRepos({ paths: [missing], stateDir, cloudRoots: [] });
    const again = await syncRepos({ paths: [missing], stateDir, cloudRoots: [] });
    expect(again.results[0]).toMatchObject({ status: "skipped", reason: "missing", cached: false });
  });

  it("같은 레포를 다른 표기로 받거나 동시에 두 번 불러도 fetch는 한 번이다", async () => {
    const [repo] = repoDirs(1);
    const { run, stats } = fakeGit(() => 150);
    const a = syncRepos({ paths: [repo!, `${repo}${path.sep}`], stateDir, git: run, cloudRoots: [], force: true });
    const b = syncRepos({ paths: [repo!], stateDir, git: run, cloudRoots: [], force: true });
    const [reportA, reportB] = await Promise.all([a, b]);
    expect(reportA.results).toHaveLength(1);
    expect(reportB.results).toHaveLength(1);
    expect(stats.fetches).toBe(1);
  });

  it("다른 프로세스가 같은 레포를 잡고 있으면 기다렸다가 그 결과를 받아 쓴다", async () => {
    const [repo] = repoDirs(1);
    const key = repoSyncKey(repo!);
    const target = lockTarget(stateDir, key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const release = await lockfile.lock(target, { realpath: false, lockfilePath: `${target}.lock` });
    const { run, stats } = fakeGit();

    const pending = syncRepos({ paths: [repo!], stateDir, git: run, cloudRoots: [], force: true });
    await sleep(300);
    await recordRepoResult(
      stateDir,
      key,
      { path: repo!, status: "updated", commits: 3, finishedAt: new Date().toISOString(), cached: false },
      new Date(),
    );
    await release();

    const report = await pending;
    expect(report.results[0]).toMatchObject({ status: "updated", commits: 3, cached: true });
    expect(stats.fetches).toBe(0);
  });

  it("동시 실행 수를 상한 안에 둔다", async () => {
    const repos = repoDirs(6);
    const { run, stats } = fakeGit(() => 60);
    const report = await syncRepos({ paths: repos, stateDir, git: run, cloudRoots: [], concurrency: 2 });
    expect(report.results).toHaveLength(6);
    expect(stats.maxActive).toBe(2);
  });

  it("끝나기 전의 보고서는 남은 레포를 pending과 '진행 중'으로 보여 주고, 끝나면 기록에 남긴다", async () => {
    const [fast, slow] = repoDirs(2);
    const { run } = fakeGit((cwd) => (cwd === slow ? 2000 : 0));
    const runHandle = startRepoSync({ paths: [fast!, slow!], stateDir, git: run, cloudRoots: [] });
    // mcw: 고정 대기(150ms)는 전체 스위트 부하에서 빠른 레포가 아직 안 끝나 깨졌다 — 끝날 때까지 기다린다.
    await vi.waitFor(() => expect(runHandle.snapshot().results).toHaveLength(1), { timeout: 1500 });
    const early = runHandle.snapshot();
    expect(early.results.map((result) => result.path)).toEqual([fast]);
    expect(early.pending).toEqual([slow]);
    expect(early.summary).toContain("진행 중");

    const done = await runHandle.done;
    expect(done.pending).toEqual([]);
    const state = await readRepoSyncState(stateDir);
    expect(Object.keys(state.repos)).toHaveLength(2);
  });

  it("마지막 기록만으로 요약을 만들고, 기록 없는 레포는 '기록 없음'으로 둔다", async () => {
    const [known, unknown] = repoDirs(2);
    const { run } = fakeGit();
    await syncRepos({ paths: [known!], stateDir, git: run, cloudRoots: [] });
    const report = await lastRepoSyncReport([known!, unknown!], stateDir);
    expect(report.results[0]).toMatchObject({ path: known, status: "up-to-date", cached: true });
    expect(report.pending).toEqual([unknown]);
    expect(report.summary).toContain("기록 없음");
  });

  it("사용자 제외 목록(config.json)을 따른다", async () => {
    const [repo] = repoDirs(1);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, "config.json"), JSON.stringify({ excludePaths: [root] }));
    const { run, stats } = fakeGit();
    const report = await syncRepos({ paths: [repo!], stateDir, git: run, cloudRoots: [] });
    expect(report.results[0]).toMatchObject({ status: "skipped", reason: "cloud-sync" });
    expect(stats.fetches).toBe(0);
  });
});
