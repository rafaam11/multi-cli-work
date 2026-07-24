// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedProject } from "../../shared/project-types";
import { readGitDiff } from "./git-diff";
import { defaultWorktreePath, normalizeWorkspacePath } from "./git-worktree";
import { parseWorktreeRegistry, pruneMissingWorktrees, readWorktreeRegistry } from "./worktree-registry";
import { WorktreeService } from "./worktree-service";

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

function service(removeWorktreeSessions = vi.fn(async () => undefined), hasWorktreeSessions?: (id: string) => boolean) {
  let nextId = 0;
  return {
    removeWorktreeSessions,
    service: new WorktreeService({
      registryPath,
      getProject: async (projectId) => (projectId === "project-1" ? project() : null),
      removeWorktreeSessions,
      ...(hasWorktreeSessions ? { hasWorktreeSessions } : {}),
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

describe("worktree service against a real repo", () => {
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
    const removeWorktreeSessions = vi.fn(async () => undefined);
    const { service: worktrees } = service(removeWorktreeSessions);
    const created = await worktrees.create("project-1", "feature-clean");

    const result = await worktrees.remove(created.id, false);

    expect(result).toEqual({ removed: true });
    expect(removeWorktreeSessions).toHaveBeenCalledWith(created.id);
    await expect(fs.stat(created.path)).rejects.toThrow();
    expect((await readWorktreeRegistry({ registryPath })).worktrees).toEqual({});
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

  it("keeps stale registry entries that still own sessions during explicit cleanup", async () => {
    const active = new Set<string>();
    const { service: worktrees } = service(undefined, (id) => active.has(id));
    const created = await worktrees.create("project-1", "feature-stale");
    active.add(created.id);
    await git(repoRoot, "worktree", "remove", created.path);

    await worktrees.cleanupStale("project-1");
    expect((await readWorktreeRegistry({ registryPath })).worktrees[created.id]).toBeDefined();

    active.clear();
    await worktrees.cleanupStale("project-1");
    expect((await readWorktreeRegistry({ registryPath })).worktrees[created.id]).toBeUndefined();
  });

  it("prunes registry entries whose directory has disappeared", async () => {
    const { service: worktrees } = service();
    const kept = await worktrees.create("project-1", "feature-kept");
    const doomed = await worktrees.create("project-1", "feature-doomed");
    await fs.rm(doomed.path, { recursive: true, force: true });

    const pruned = await pruneMissingWorktrees("2026-07-13T02:00:00.000Z", { registryPath });

    expect(Object.keys(pruned.worktrees)).toEqual([kept.id]);
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
