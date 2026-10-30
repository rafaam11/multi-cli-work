// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedProject } from "../../shared/project-types";
import { readGitDiff } from "./git-diff";
import { defaultWorktreePath, normalizeWorkspacePath, removeGitWorktree } from "./git-worktree";
import { parseWorktreeRegistry, readWorktreeRegistry } from "./worktree-registry";
import {CheckoutAdmission} from "../herdr/checkout-admission";
import { WorktreeService, type WorktreeServiceOptions } from "./worktree-service";

const execFileAsync = promisify(execFile);

let tempRoot: string;
let repoRoot: string;
let registryPath: string;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args],
    { cwd, windowsHide: true },
  );
  return result.stdout;
}

function project(): SharedProject {
  return {
    id: "project-1",
    rootPath: repoRoot,
    displayName: "Repo",
    sources: ["manual"],
    providerRefs: { claude: [], codex: [] },
    status: null,
    memo: "",
    tracks: [],
    hidden: false,
    order: null,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
  };
}

function service(
  removeWorktreeSessions = vi.fn(async () => undefined),
  hasWorktreeSessions?: (id: string) => boolean | Promise<boolean>,
  stopWorktreeSessions = vi.fn(async () => undefined),
  runTeardown?: WorktreeServiceOptions["runTeardown"],
  holdWorktreeRemoval?: WorktreeServiceOptions["holdWorktreeRemoval"],
  settleWorktreeRemoval?: WorktreeServiceOptions["settleWorktreeRemoval"],
) {
  let nextId = 0;
  return {
    removeWorktreeSessions,
    stopWorktreeSessions,
    service: new WorktreeService({
      registryPath,
      holdWorktreeRemoval,
      settleWorktreeRemoval,
      getProject: async (projectId) => (projectId === "project-1" ? project() : null),
      removeWorktreeSessions,
      stopWorktreeSessions,
      ...(hasWorktreeSessions ? { hasWorktreeSessions } : {}),
      ...(runTeardown ? { runTeardown } : {}),
      idFactory: () => `worktree-${++nextId}`,
      now: () => "2026-07-13T01:00:00.000Z",
    }),
  };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-worktree-"));
  repoRoot = path.join(tempRoot, "repo");
  registryPath = path.join(tempRoot, "registry", "worktrees.json");
  await fs.mkdir(repoRoot, { recursive: true });
  await git(repoRoot, "init", "-b", "main");
  await fs.writeFile(path.join(repoRoot, "readme.md"), "hello\n", "utf8");
  await git(repoRoot, "add", ".");
  await git(repoRoot, "commit", "-m", "init");
});

afterEach(async () => {
  // Windows briefly holds handles after git exits; plain rm intermittently fails with EBUSY.
  await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

// Every case here runs real git, several times over; a Windows runner can take seconds per call.
describe("worktree service against a real repo", { timeout: 30_000 }, () => {
  it("resolves session cwd inside a newly created worktree and rejects unrelated repositories", async () => {
    const { service: worktrees } = service();
    const externalPath = path.join(tempRoot, "external");
    await git(repoRoot, "worktree", "add", "-b", "external", externalPath);
    const nested = path.join(externalPath, "src");
    await fs.mkdir(nested);
    const location = await worktrees.resolveSessionWorkspace(project().id, nested, [project()]);
    expect(location?.worktreeId).toBeTruthy();
    expect(location?.cwd).toBe(nested);
    expect(await fs.realpath((await worktrees.get(location!.worktreeId!))!.path)).toBe(await fs.realpath(externalPath));
    expect(await worktrees.resolveSessionWorkspace(project().id, repoRoot, [project()])).toEqual({ cwd: repoRoot });
    const unrelated = path.join(tempRoot, "unrelated");
    await fs.mkdir(unrelated);
    await git(unrelated, "init");
    expect(await worktrees.resolveSessionWorkspace(project().id, unrelated, [project()])).toBeNull();
  });
  it("discovers external worktrees and reuses their registry id", async () => {
    const { service: worktrees } = service();
    const externalPath = path.join(tempRoot, "외부 worktree");
    await git(repoRoot, "worktree", "add", "-b", "external", externalPath);

    const first = await worktrees.sync([project()]);
    const discovered = first.workspaces.find(
      (workspace) => normalizeWorkspacePath(workspace.path) === normalizeWorkspacePath(externalPath),
    );
    expect(discovered).toMatchObject({ kind: "worktree", branch: "external", availability: "available" });

    const second = await worktrees.sync([project()]);
    expect(
      second.workspaces.find(
        (workspace) => normalizeWorkspacePath(workspace.path) === normalizeWorkspacePath(externalPath),
      )?.worktreeId,
    ).toBe(discovered?.worktreeId);
    await expect(worktrees.ownerForPath(externalPath, [project()])).resolves.toEqual({
      projectId: "project-1",
      worktreeId: discovered?.worktreeId,
    });
  });

  it("creates new, existing local and remote tracking branches with collision-free paths", async () => {
    const { service: worktrees } = service();
    await git(repoRoot, "branch", "existing");
    const bare = path.join(tempRoot, "remote.git");
    await git(tempRoot, "init", "--bare", bare);
    await git(repoRoot, "remote", "add", "origin", bare);
    await git(repoRoot, "push", "-u", "origin", "main");
    await git(repoRoot, "branch", "-r");

    const firstPath = defaultWorktreePath(repoRoot, "feature/new");
    await fs.mkdir(firstPath, { recursive: true });
    const preview = await worktrees.previewPath("project-1", "feature/new");
    expect(preview).toBe(`${firstPath}-2`);

    const created = await worktrees.create("project-1", {
      kind: "new",
      branch: "feature/new",
      startPoint: "main",
    });
    const local = await worktrees.create("project-1", { kind: "local", branch: "existing" });
    const remote = await worktrees.create("project-1", {
      kind: "remote",
      remoteRef: "origin/main",
      localBranch: "tracked-main",
    });

    expect(created.path).toBe(`${firstPath}-2`);
    expect((await git(local.path, "branch", "--show-current")).trim()).toBe("existing");
    expect((await git(remote.path, "rev-parse", "--abbrev-ref", "@{upstream}")).trim()).toBe("origin/main");
  });

  it("refreshes an existing registry entry after an external branch checkout", async () => {
    const { service: worktrees } = service();
    const created = await worktrees.create("project-1", "before");
    await git(repoRoot, "branch", "after");
    await git(created.path, "checkout", "after");

    await expect(worktrees.create("project-1", { kind: "local", branch: "before" })).resolves.toMatchObject({ branch: "before" });
    const refreshed = await worktrees.get(created.id);
    expect(refreshed).toMatchObject({ id: created.id, path: created.path, branch: "after" });
  });

  it("excludes automation refs from creation choices without deleting Git refs", async () => {
    const { service: worktrees } = service();
    for (const branch of ["dependabot/npm/pkg", "renovate/pkg", "feature/real", "release/next"]) {
      await git(repoRoot, "branch", branch);
    }
    await git(repoRoot, "update-ref", "refs/remotes/company/dependabot/npm/pkg", "HEAD");
    await git(repoRoot, "update-ref", "refs/remotes/company/feature/real", "HEAD");
    const options = await worktrees.creationOptions("project-1");
    expect(options.localBranches).toEqual(["feature/real", "main", "release/next"]);
    expect(options.remoteBranches).toEqual(["company/feature/real"]);
    expect(await git(repoRoot, "branch", "--list", "dependabot/*")).toContain("dependabot/npm/pkg");
  });

  it("creates a git worktree outside the repo and records it", async () => {
    const { service: worktrees } = service();

    const created = await worktrees.create("project-1", "feature/one");

    expect(created.path).toBe(defaultWorktreePath(repoRoot, "feature/one"));
    expect(created.path.startsWith(repoRoot + path.sep)).toBe(false);
    expect((await fs.stat(created.path)).isDirectory()).toBe(true);
    expect((await git(created.path, "rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("feature/one");
    expect((await readWorktreeRegistry({ registryPath })).worktrees[created.id]).toEqual(created);
  });

  it("refuses duplicates, from the registry and from git, leaving no entry behind", async () => {
    const { service: worktrees } = service();
    await worktrees.create("project-1", "feature-dup");

    // Same branch again: the registry already claims that path.
    await expect(worktrees.create("project-1", "feature-dup")).rejects.toThrow(/already uses/);

    // A branch that exists in git but not in the registry: git itself refuses.
    await git(repoRoot, "branch", "taken");
    await expect(worktrees.create("project-1", "taken")).rejects.toThrow(/git worktree add/);
    expect(Object.keys((await readWorktreeRegistry({ registryPath })).worktrees)).toHaveLength(1);
  });

  it("removes a clean worktree after stopping its sessions", async () => {
    const stopWorktreeSessions = vi.fn(async () => undefined);
    let createdPath = "";
    const removeWorktreeSessions = vi.fn(async () => {
      await expect(fs.stat(createdPath)).rejects.toThrow();
      expect(stopWorktreeSessions).toHaveBeenCalled();
    });
    const { service: worktrees } = service(removeWorktreeSessions, undefined, stopWorktreeSessions);
    const created = await worktrees.create("project-1", "feature-clean");
    createdPath = created.path;

    const result = await worktrees.remove(created.id, false);

    expect(result).toEqual({ removed: true });
    expect(stopWorktreeSessions).toHaveBeenCalledWith(created.id);
    expect(removeWorktreeSessions).toHaveBeenCalledWith(created.id);
    await expect(fs.stat(created.path)).rejects.toThrow();
    expect((await readWorktreeRegistry({ registryPath })).worktrees).toEqual({});
  });

  it("runs the teardown script after the sessions stop and before git deletes the worktree", async () => {
    let createdPath = "";
    const stopWorktreeSessions = vi.fn(async () => undefined);
    const runTeardown = vi.fn(async () => {
      expect(stopWorktreeSessions).toHaveBeenCalled();
      await fs.stat(createdPath);
      return { ok: true as const };
    });
    const { service: worktrees } = service(undefined, undefined, stopWorktreeSessions, runTeardown);
    const created = await worktrees.create("project-1", "feature-teardown");
    createdPath = created.path;

    expect(await worktrees.remove(created.id, false)).toEqual({ removed: true });
    expect(runTeardown).toHaveBeenCalledWith(expect.objectContaining({ id: created.id }), expect.objectContaining({ id: "project-1" }));
    await expect(fs.stat(created.path)).rejects.toThrow();
  });

  it("keeps the worktree when its teardown fails, and removes it when told to skip the script", async () => {
    const runTeardown = vi.fn(async () => ({ ok: false as const, message: "정리 실패", output: "boom" }));
    const { service: worktrees, removeWorktreeSessions } = service(undefined, undefined, undefined, runTeardown);
    const created = await worktrees.create("project-1", "feature-teardown-fails");

    expect(await worktrees.remove(created.id, false)).toEqual({
      removed: false,
      reason: "teardown-failed",
      message: "정리 실패",
      output: "boom",
    });
    await fs.stat(created.path);
    expect(removeWorktreeSessions).not.toHaveBeenCalled();
    expect((await readWorktreeRegistry({ registryPath })).worktrees[created.id]).toBeDefined();

    expect(await worktrees.remove(created.id, false, { skipTeardown: true })).toEqual({ removed: true });
    expect(runTeardown).toHaveBeenCalledOnce();
  });
  it('checks sessions again after teardown and preserves the checkout if fresh observation fails',async()=>{
    const stop=vi.fn(async()=>undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Host unavailable after teardown'));
    const teardown=vi.fn(async()=>({ok:true as const}));
    const {service:worktrees,removeWorktreeSessions}=service(undefined,undefined,stop,teardown);
    const created=await worktrees.create('project-1','late-observation');
    await expect(worktrees.remove(created.id,false)).rejects.toThrow('Host unavailable after teardown');
    expect(teardown).toHaveBeenCalledOnce();expect(removeWorktreeSessions).not.toHaveBeenCalled();
    await expect(fs.stat(created.path)).resolves.toBeDefined();expect(await worktrees.get(created.id)).not.toBeNull();
  });

  it("keeps sessions and the registry when git removal fails after processes stop", async () => {
    const removeWorktreeSessions = vi.fn(async () => undefined);
    let createdPath = "";
    const stopWorktreeSessions = vi.fn(async (_id: string) => {
      await fs.writeFile(path.join(createdPath, "readme.md"), "changed after status\n", "utf8");
    });
    const { service: worktrees } = service(removeWorktreeSessions, undefined, stopWorktreeSessions);
    const created = await worktrees.create("project-1", "feature-remove-fails");
    createdPath = created.path;

    await expect(worktrees.remove(created.id, false)).rejects.toThrow();

    expect(stopWorktreeSessions).toHaveBeenCalledWith(created.id);
    expect(removeWorktreeSessions).not.toHaveBeenCalled();
    expect((await readWorktreeRegistry({ registryPath })).worktrees[created.id]).toBeDefined();
  });

  it("retries session cleanup after Git already removed the worktree", async () => {
    const removeWorktreeSessions = vi.fn()
      .mockRejectedValueOnce(new Error("log cleanup failed"))
      .mockResolvedValueOnce(undefined);
    const { service: worktrees } = service(removeWorktreeSessions);
    const created = await worktrees.create("project-1", "feature-cleanup-retry");

    await expect(worktrees.remove(created.id, false)).rejects.toThrow("log cleanup failed");
    await expect(fs.stat(created.path)).rejects.toThrow();
    expect((await readWorktreeRegistry({ registryPath })).worktrees[created.id]).toBeDefined();

    await expect(worktrees.remove(created.id, false)).resolves.toEqual({ removed: true });
    expect(removeWorktreeSessions).toHaveBeenCalledTimes(2);
    expect((await readWorktreeRegistry({ registryPath })).worktrees[created.id]).toBeUndefined();
  });

  it("aborts before stopping sessions when git status cannot be read", async () => {
    const removeWorktreeSessions = vi.fn(async () => undefined);
    const stopWorktreeSessions = vi.fn(async () => undefined);
    const { service: worktrees } = service(removeWorktreeSessions, undefined, stopWorktreeSessions);
    const created = await worktrees.create("project-1", "feature-status-fails");
    await fs.rename(path.join(created.path, ".git"), path.join(created.path, ".git-missing"));

    await expect(worktrees.remove(created.id, false)).rejects.toThrow();

    expect(stopWorktreeSessions).not.toHaveBeenCalled();
    expect(removeWorktreeSessions).not.toHaveBeenCalled();
    expect((await readWorktreeRegistry({ registryPath })).worktrees[created.id]).toBeDefined();

    await expect(worktrees.remove(created.id, true)).rejects.toThrow();
    expect(stopWorktreeSessions).not.toHaveBeenCalled();
    expect(removeWorktreeSessions).not.toHaveBeenCalled();
  });

  it("refuses to remove a dirty worktree without touching its sessions, until forced", async () => {
    const removeWorktreeSessions = vi.fn(async () => undefined);
    const { service: worktrees } = service(removeWorktreeSessions);
    const created = await worktrees.create("project-1", "feature-dirty");
    await fs.writeFile(path.join(created.path, "wip.txt"), "uncommitted\n", "utf8");

    const refused = await worktrees.remove(created.id, false);

    expect(refused).toEqual({ removed: false, reason: "dirty", message: expect.stringContaining("1개") });
    expect(removeWorktreeSessions).not.toHaveBeenCalled();
    expect((await fs.stat(created.path)).isDirectory()).toBe(true);

    const forced = await worktrees.remove(created.id, true);

    expect(forced).toEqual({ removed: true });
    expect(removeWorktreeSessions).toHaveBeenCalledWith(created.id);
    await expect(fs.stat(created.path)).rejects.toThrow();
  });

  it("requires an explicit unlock before removal", async () => {
    const { service: worktrees } = service();
    const created = await worktrees.create("project-1", "feature-locked");
    await git(repoRoot, "worktree", "lock", "--reason", "test lock", created.path);

    await expect(worktrees.remove(created.id, false)).rejects.toThrow(/unlocked/i);
    await worktrees.unlock(created.id);
    await expect(worktrees.remove(created.id, false)).resolves.toEqual({ removed: true });
  });

  it("removes stale registry entries without sessions during sync", async () => {
    const { service: worktrees } = service();
    const created = await worktrees.create("project-1", "feature-stale-sessionless");
    await git(repoRoot, "worktree", "remove", created.path);

    const snapshot = await worktrees.sync([project()]);

    expect(snapshot.workspaces.some((workspace) => workspace.worktreeId === created.id)).toBe(false);
    expect((await readWorktreeRegistry({ registryPath })).worktrees[created.id]).toBeUndefined();
  });

  it("keeps a worktree created while a sync is in flight, under its original id", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let staleChecks = 0;
    // The stale entry parks the first sync inside this session check, holding it in flight while
    // create() writes a fresh entry the sync's registry snapshot has never seen.
    const { service: worktrees } = service(undefined, async () => {
      staleChecks += 1;
      if (staleChecks === 1) await gate;
      return false;
    });
    const stale = await worktrees.create("project-1", "feature-stale-race");
    await git(repoRoot, "worktree", "remove", stale.path);

    // Both waits sit on real git commands. vi.waitFor's default 1 s is shorter than those can take
    // on a loaded Windows runner, so the bound is spelled out — and the test's own with it.
    const gitWait = { timeout: 10_000 };
    const inFlight = worktrees.sync([project()]);
    await vi.waitFor(() => expect(staleChecks).toBe(1), gitWait);
    const creating = worktrees.create("project-1", "feature-race");
    await vi.waitFor(async () => {
      const { worktrees: entries } = await readWorktreeRegistry({ registryPath });
      expect(Object.values(entries).some((entry) => entry.branch === "feature-race")).toBe(true);
    }, gitWait);
    release();

    const created = await creating;
    await inFlight;
    const registry = await readWorktreeRegistry({ registryPath });
    expect(registry.worktrees[created.id]).toBeDefined();
    expect(registry.worktrees[stale.id]).toBeUndefined();
    const after = await worktrees.sync([project()]);
    expect(after.workspaces.find((workspace) => workspace.worktreeId === created.id)).toMatchObject({
      branch: "feature-race",
      availability: "available",
    });
  }, 30_000);

  it("keeps stale registry entries that still own sessions during explicit cleanup", async () => {
    const active = new Set<string>();
    const { service: worktrees } = service(undefined, (id) => active.has(id));
    const created = await worktrees.create("project-1", "feature-stale");
    active.add(created.id);
    await git(repoRoot, "worktree", "remove", created.path);

    const snapshot = await worktrees.sync([project()]);
    expect(snapshot.workspaces.find((workspace) => workspace.worktreeId === created.id)).toMatchObject({
      availability: "missing",
      prunableReason: "Git no longer reports this worktree",
    });
    expect((await readWorktreeRegistry({ registryPath })).worktrees[created.id]).toBeDefined();

    await worktrees.cleanupStale("project-1");
    expect((await readWorktreeRegistry({ registryPath })).worktrees[created.id]).toBeDefined();

    active.clear();
    await worktrees.cleanupStale("project-1");
    expect((await readWorktreeRegistry({ registryPath })).worktrees[created.id]).toBeUndefined();
  });

});

describe("readGitDiff", () => {
  it("reports tracked changes and untracked files separately", async () => {
    await fs.writeFile(path.join(repoRoot, "readme.md"), "hello changed\n", "utf8");
    await fs.writeFile(path.join(repoRoot, "fresh.txt"), "new\n", "utf8");

    const result = await readGitDiff(repoRoot);

    expect(result.isRepo).toBe(true);
    expect(result.diff).toContain("readme.md");
    expect(result.diff).toContain("+hello changed");
    expect(result.untracked).toEqual(["fresh.txt"]);
    expect(result.truncated).toBe(false);
  });

  it("collapses a folder that is not a repository to isRepo: false", async () => {
    const plainDir = path.join(tempRoot, "plain");
    await fs.mkdir(plainDir, { recursive: true });

    expect(await readGitDiff(plainDir)).toEqual({ isRepo: false, diff: "", untracked: [], truncated: false });
  });
});

describe("worktree registry parsing", () => {
  it("rejects unknown fields and mismatched keys", () => {
    const worktree = {
      id: "w1",
      projectId: "p1",
      path: "C:\\wt",
      branch: "main",
      createdAt: "2026-07-13T00:00:00.000Z",
      updatedAt: "2026-07-13T00:00:00.000Z",
    };
    const base = { schemaVersion: 1, updatedAt: "2026-07-13T00:00:00.000Z" };

    expect(() => parseWorktreeRegistry({ ...base, worktrees: { w1: { ...worktree, extra: 1 } } })).toThrow(
      /unknown fields/,
    );
    expect(() => parseWorktreeRegistry({ ...base, worktrees: { other: worktree } })).toThrow(/does not match/);
    expect(parseWorktreeRegistry({ ...base, worktrees: { w1: worktree } }).worktrees.w1).toEqual(worktree);
  });
});

it("holds host admission across delayed stop and real Git deletion, releasing after cleanup",async()=>{
 const guard=new CheckoutAdmission(tempRoot,async()=>[{pid:10,parentPid:1,startId:"boot:10",name:"gui",executable:"/gui"}]);
 let stopped!:()=>void,finishStop!:()=>void,cleaning!:()=>void,finishCleanup!:()=>void;
 const stopReached=new Promise<void>(r=>stopped=r),stopGate=new Promise<void>(r=>finishStop=r);
 const cleanupReached=new Promise<void>(r=>cleaning=r),cleanupGate=new Promise<void>(r=>finishCleanup=r);
 const stop=vi.fn(async()=>{stopped();await stopGate;});
 const cleanup=vi.fn(async()=>{cleaning();await cleanupGate;});
 const {service:worktrees}=service(cleanup,undefined,stop,undefined,async cwd=>{await guard.acquire(cwd,"deleting",10);return ()=>guard.release("deleting");});
 const created=await worktrees.create("project-1","race");
 const removal=worktrees.remove(created.id,true);await stopReached;
 await expect(guard.launch(created.path,async()=>{})).rejects.toThrow(/removal/);
 finishStop();await cleanupReached;
 await expect(fs.access(created.path)).rejects.toThrow();
 await expect(guard.launch(created.path,async()=>{})).rejects.toThrow(/removal/);
 finishCleanup();await expect(removal).resolves.toEqual({removed:true});
 await expect(guard.launch(created.path,async()=>"open")).resolves.toBe("open");
});
it("releases host admission when session stop fails and preserves the checkout",async()=>{
 const guard=new CheckoutAdmission(tempRoot,async()=>[{pid:10,parentPid:1,startId:"boot:10",name:"gui",executable:"/gui"}]);
 const {service:worktrees}=service(undefined,undefined,vi.fn(async()=>{throw new Error("stop uncertain");}),undefined,async cwd=>{await guard.acquire(cwd,"deleting",10);return ()=>guard.release("deleting");});
 const created=await worktrees.create("project-1","failed-stop");
 await expect(worktrees.remove(created.id,true)).rejects.toThrow("stop uncertain");
 await fs.access(created.path);await expect(guard.launch(created.path,async()=>true)).resolves.toBe(true);
});

it("keeps the worktree record retryable if hold release fails after Git removal",async()=>{
 const release=vi.fn().mockRejectedValueOnce(new Error("host disconnected during release")).mockResolvedValue(undefined);
 const {service:worktrees}=service(undefined,undefined,undefined,undefined,async()=>release,async()=>release());
 const created=await worktrees.create("project-1","release-retry");
 await expect(worktrees.remove(created.id,true)).rejects.toThrow("release");
 await expect(fs.access(created.path)).rejects.toThrow();expect(await worktrees.get(created.id)).not.toBeNull();
 await expect(worktrees.remove(created.id,true)).resolves.toEqual({removed:true});expect(await worktrees.get(created.id)).toBeNull();
});

for(const applied of [false,true])it(`retains durable removal across sync and restart when release response fails ${applied?'after':'before'} applying`,async()=>{
 let guard=new CheckoutAdmission(tempRoot,async()=>[{pid:10,parentPid:1,startId:"boot:10",name:"gui",executable:"/gui"}],async()=>"boot-one");
 let fail=true;const ids:string[]=[];
 const hold=async(cwd:string,id:string)=>{ids.push(id);await guard.acquire(cwd,id,10);const release=async()=>{if(fail){fail=false;if(applied)await guard.release(id);throw new Error("release transport lost");}await guard.release(id);};release.removeGit=(repo:string,cwd:string,force:boolean)=>guard.remove(id,repo,cwd,force);return release;};
 const make=()=>service(undefined,undefined,undefined,undefined,hold,id=>guard.release(id)).service;
 const first=make(),created=await first.create("project-1",`durable-${applied}`);
 await expect(first.remove(created.id,true)).rejects.toThrow("release transport lost");
 await expect(fs.access(created.path)).rejects.toThrow();
 await first.sync([project()]);await first.cleanupStale("project-1");expect(await first.get(created.id)).not.toBeNull();
 // Even if a stale GUI erased the old registry row, the independent operation restores it.
 const registry=await readWorktreeRegistry({registryPath});delete registry.worktrees[created.id];await fs.writeFile(registryPath,JSON.stringify(registry));
 guard=new CheckoutAdmission(tempRoot,async()=>[{pid:10,parentPid:1,startId:"boot:10",name:"gui",executable:"/gui"}],async()=>"boot-one");
 const restarted=make();expect((await restarted.list()).map(w=>w.id)).toContain(created.id);
 await restarted.sync([project()]);await restarted.cleanupStale("project-1");expect(await restarted.get(created.id)).not.toBeNull();
 await expect(restarted.remove(created.id,true)).resolves.toEqual({removed:true});
 expect(ids).toHaveLength(1);expect(await restarted.get(created.id)).toBeNull();
 await expect(guard.launch(created.path,async()=>true)).resolves.toBe(true);
});
it("reuses the durable operation after an acquire acknowledgement is lost in the same GUI",async()=>{
 const guard=new CheckoutAdmission(tempRoot,async()=>[{pid:10,parentPid:1,startId:"boot:10",name:"gui",executable:"/gui"}],async()=>"boot-one");let first=true;const ids:string[]=[];
 const {service:worktrees}=service(undefined,undefined,undefined,undefined,async(cwd,id)=>{ids.push(id);await guard.acquire(cwd,id,10);if(first){first=false;throw new Error("acquire reply lost");}const release=()=>guard.release(id);release.removeGit=(repo:string,cwd:string,force:boolean)=>guard.remove(id,repo,cwd,force);return release;},id=>guard.release(id));
 const created=await worktrees.create("project-1","acquire-retry");await expect(worktrees.remove(created.id,true)).rejects.toThrow("acquire reply lost");
 await worktrees.sync([project()]);await expect(worktrees.remove(created.id,true)).resolves.toEqual({removed:true});expect(ids[0]).toBe(ids[1]);
});

it("host-owned Git finishes after the GUI exits and refuses takeover or release while its child is running",async()=>{
 const {service:worktrees}=service(),created=await worktrees.create("project-1","host-owned");
 let ready!:()=>void,finish!:()=>void;const started=new Promise<void>(r=>ready=r),gate=new Promise<void>(r=>finish=r);
 const inventory=vi.fn(async()=>[{pid:10,parentPid:1,startId:"boot:10",name:"gui",executable:"/gui"}]);
 const remove=vi.fn(async(repo:string,cwd:string,force:boolean)=>{ready();await gate;await removeGitWorktree(repo,cwd,force);});
 const guard=new CheckoutAdmission(tempRoot,inventory,async()=>"same-boot",remove);
 await guard.acquire(created.path,"owned",10);const deleting=guard.remove("owned",repoRoot,created.path,false);await started;
 inventory.mockResolvedValue([{pid:20,parentPid:1,startId:"boot:20",name:"new-gui",executable:"/gui"}]);
 expect(await guard.busy()).toBe(true);
 await expect(guard.acquire(created.path,"owned",20)).rejects.toThrow(/still running/);
 await expect(guard.release("owned")).rejects.toThrow(/still running/);
 await expect(guard.launch(created.path,async()=>{})).rejects.toThrow(/removal/);
 finish();await deleting;expect(remove).toHaveBeenCalledWith(repoRoot,created.path,false);
 await guard.acquire(created.path,"owned",20);await guard.release("owned");expect(await guard.busy()).toBe(false);
 await expect(fs.access(created.path)).rejects.toThrow();
});
it("host removal rejects mismatched repository membership and a main checkout",async()=>{
 const {service:worktrees}=service(),created=await worktrees.create("project-1","membership");
 const guard=new CheckoutAdmission(tempRoot,async()=>[{pid:10,parentPid:1,startId:"boot:10",name:"gui",executable:"/gui"}],async()=>"boot");
 await guard.acquire(created.path,"child",10);
 await expect(guard.remove("child",repoRoot,repoRoot,true)).rejects.toThrow(/lease/);
 const unrelated=path.join(tempRoot,"unrelated");await fs.mkdir(unrelated);await git(unrelated,"init","-b","main");await fs.writeFile(path.join(unrelated,"a"),"a");await git(unrelated,"add",".");await git(unrelated,"commit","-m","initial");
 await expect(guard.remove("child",unrelated,created.path,true)).rejects.toThrow(/repository/);
 await guard.release("child");await guard.acquire(repoRoot,"main",10);
 await expect(guard.remove("main",repoRoot,repoRoot,true)).rejects.toThrow(/repository/);
 await fs.access(created.path);await fs.access(repoRoot);await guard.release("main");
});
