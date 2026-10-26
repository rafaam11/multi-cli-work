// @vitest-environment node
// 출처: harness-manager src/main/services/repo-sync/sync-repo.test.ts — 계약 harness-manager docs/contracts/repo-sync.md.
// HM이 없는 PC의 대체 구현이다. 판정 순서·잠금·state.json이 HM과 같아야 하므로 HM 쪽이 바뀌면 같이 고친다.
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyGitFailure, GitRunError, parseBranchStatus } from "./git";
import { syncRepo } from "./sync-repo";
import { createRemoteFixture, type RemoteFixture } from "./test-fixtures";

// mcw: 실제 git을 여러 번 부른다. 전체 스위트가 병렬로 돌 때 5초 기본값을 넘긴다.
vi.setConfig({ testTimeout: 30_000 });

let fx: RemoteFixture;

const sync = (repo: string, extra: Parameters<typeof syncRepo>[1] = {}) => syncRepo(repo, { cloudRoots: [], ...extra });

describe("syncRepo (실제 git)", () => {
  beforeEach(() => {
    fx = createRemoteFixture();
  });
  afterEach(() => fx.cleanup());

  it("다른 PC가 push한 커밋을 fast-forward로 받는다", async () => {
    fx.pushFromOther(2);
    const result = await sync(fx.work);
    expect(result).toMatchObject({ status: "updated", commits: 2, branch: "main", upstream: "origin/main", cached: false });
    expect(fx.head(fx.work)).toBe(fx.head(fx.other));
  });

  it("받을 것이 없으면 이미 최신, 로컬만 앞서면 ahead를 남긴다", async () => {
    expect(await sync(fx.work)).toMatchObject({ status: "up-to-date", ahead: 0, behind: 0 });
    fx.commit(fx.work, "local.txt", "x\n");
    expect(await sync(fx.work)).toMatchObject({ status: "up-to-date", ahead: 1, behind: 0 });
  });

  it("추적 파일에 커밋 안 된 변경이 있으면 건드리지 않는다", async () => {
    fx.pushFromOther(1);
    fs.writeFileSync(path.join(fx.work, "README.md"), "changed\n");
    const before = fx.head(fx.work);
    expect(await sync(fx.work)).toMatchObject({ status: "skipped", reason: "dirty" });
    expect(fx.head(fx.work)).toBe(before);
    expect(fs.readFileSync(path.join(fx.work, "README.md"), "utf8")).toBe("changed\n");
  });

  it("추적 안 된 파일만 있으면 진행하고, 들어오는 파일과 겹치면 덮어쓰지 않고 실패한다", async () => {
    fs.writeFileSync(path.join(fx.work, "scratch.txt"), "mine\n");
    fx.pushFromOther(1);
    expect(await sync(fx.work)).toMatchObject({ status: "updated", commits: 1 });

    fx.commit(fx.other, "clash.txt", "theirs\n");
    fx.git(fx.other, "push", "-q");
    fs.writeFileSync(path.join(fx.work, "clash.txt"), "mine\n");
    const before = fx.head(fx.work);
    expect(await sync(fx.work)).toMatchObject({ status: "failed", failKind: "overwrite" });
    expect(fx.head(fx.work)).toBe(before);
    expect(fs.readFileSync(path.join(fx.work, "clash.txt"), "utf8")).toBe("mine\n");
  });

  it("로컬과 원격이 갈라지면 merge하지 않는다", async () => {
    fx.pushFromOther(1);
    fx.commit(fx.work, "local.txt", "x\n");
    const before = fx.head(fx.work);
    expect(await sync(fx.work)).toMatchObject({ status: "skipped", reason: "diverged", ahead: 1, behind: 1 });
    expect(fx.head(fx.work)).toBe(before);
  });

  it("upstream이 없거나 detached HEAD면 건너뛴다", async () => {
    fx.git(fx.work, "switch", "-q", "-c", "feature");
    expect(await sync(fx.work)).toMatchObject({ status: "skipped", reason: "no-upstream", branch: "feature" });
    fx.git(fx.work, "switch", "-q", "--detach", "main");
    expect(await sync(fx.work)).toMatchObject({ status: "skipped", reason: "detached" });
  });

  it("merge가 멈춰 있으면 건너뛴다", async () => {
    fs.writeFileSync(path.join(fx.work, ".git", "MERGE_HEAD"), `${fx.head(fx.work)}\n`);
    expect(await sync(fx.work)).toMatchObject({ status: "skipped", reason: "in-progress-op" });
  });

  it("원격에 닿지 못하면 throw하지 않고 실패로 기록한다", async () => {
    fx.git(fx.work, "remote", "set-url", "origin", path.join(fx.root, "gone.git"));
    const result = await sync(fx.work);
    expect(result).toMatchObject({ status: "failed", failKind: "network", branch: "main" });
    expect(result.error).toBeTruthy();
  });

  it("경로가 없거나, 레포가 아니거나, 레포의 하위 폴더면 건너뛴다", async () => {
    expect(await sync(path.join(fx.root, "nope"))).toMatchObject({ status: "skipped", reason: "missing" });
    const plain = path.join(fx.root, "plain");
    fs.mkdirSync(plain);
    // 임시 폴더가 다른 레포 안에 있을 수도 있으니 결과가 not-a-repo인지만 본다(하위 폴더 판정과 같은 길).
    expect(await sync(plain)).toMatchObject({ status: "skipped", reason: "not-a-repo" });
    const sub = path.join(fx.work, "sub");
    fs.mkdirSync(sub);
    expect(await sync(sub)).toMatchObject({ status: "skipped", reason: "not-a-repo" });
  });

  it("클라우드 동기화 루트나 제외 경로 아래면 git을 부르지 않고 건너뛴다", async () => {
    const calls: string[][] = [];
    const git = async (_cwd: string, args: string[]) => {
      calls.push(args);
      return "";
    };
    expect(await sync(fx.work, { cloudRoots: [fx.root], git })).toMatchObject({ status: "skipped", reason: "cloud-sync" });
    expect(await sync(fx.work, { excludePaths: [fx.work.toUpperCase()], git, platform: "win32" })).toMatchObject({
      reason: "cloud-sync",
    });
    expect(calls).toEqual([]);
  });
});

describe("classifyGitFailure", () => {
  const fail = (stderr: string, timedOut = false) => classifyGitFailure(new GitRunError("git fetch failed", stderr, timedOut));

  it("인증 실패를 네트워크보다 먼저 가른다", () => {
    expect(fail("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.")).toMatchObject({
      failKind: "auth",
    });
    expect(fail("fatal: could not read Username for 'https://github.com': terminal prompts disabled").failKind).toBe("auth");
    expect(fail("fatal: Authentication failed for 'https://x/'").failKind).toBe("auth");
  });

  it("네트워크·시간 초과·기타를 나누고 stderr 마지막 줄을 남긴다", () => {
    expect(fail("fatal: unable to access 'https://x/': Could not resolve host: x")).toEqual({
      failKind: "network",
      error: "fatal: unable to access 'https://x/': Could not resolve host: x",
    });
    expect(fail("", true).failKind).toBe("timeout");
    expect(fail("fatal: bad object HEAD").failKind).toBe("git");
  });
});

describe("parseBranchStatus", () => {
  it("추적 파일 변경만 세고 rename의 원래 경로 레코드는 건너뛴다", () => {
    const output = [
      "# branch.oid abc",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +1 -2",
      "1 .M N... 100644 100644 100644 a b file.txt",
      "2 R. N... 100644 100644 100644 a b R100 new name.txt",
      "old name.txt",
      "? untracked.txt",
      "",
    ].join("\0");
    expect(parseBranchStatus(output)).toEqual({ branch: "main", upstream: "origin/main", ahead: 1, behind: 2, trackedChanges: 2 });
  });
});
