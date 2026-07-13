// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedProject } from "../../shared/project-types";
import { readGitDiff } from "./git-diff";
import { defaultWorktreePath } from "./git-worktree";
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

function service(removeWorktreeSessions = vi.fn(async () => undefined)) {
  let nextId = 0;
  return {
    removeWorktreeSessions,
    service: new WorktreeService({
      registryPath,
      getProject: async (projectId) => (projectId === "project-1" ? project() : null),
      removeWorktreeSessions,
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
