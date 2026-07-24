import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { countChangedFiles } from "./git-status";

const execFileAsync = promisify(execFile);

/** `git worktree add` checks files out, so it gets far more time than a status query. */
const ADD_TIMEOUT_MS = 60_000;
const REMOVE_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 5_000;

export interface ParsedGitWorktree {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  lockedReason: string | null;
  prunableReason: string | null;
}

export function normalizeWorkspacePath(input: string, platform: NodeJS.Platform = process.platform): string {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const normalized = pathApi.normalize(pathApi.resolve(input));
  return platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

/** Parses `git worktree list --porcelain -z` without ever splitting path values on whitespace. */
export function parseGitWorktreePorcelain(output: string): ParsedGitWorktree[] {
  const result: ParsedGitWorktree[] = [];
  let current: ParsedGitWorktree | null = null;
  const finish = () => {
    if (current) result.push(current);
    current = null;
  };
  for (const token of output.split("\0")) {
    if (!token) {
      finish();
      continue;
    }
    if (token.startsWith("worktree ")) {
      finish();
      current = {
        path: token.slice("worktree ".length),
        head: null,
        branch: null,
        detached: false,
        lockedReason: null,
        prunableReason: null,
      };
    } else if (current && token.startsWith("HEAD ")) current.head = token.slice(5);
    else if (current && token.startsWith("branch refs/heads/")) current.branch = token.slice("branch refs/heads/".length);
    else if (current && token === "detached") current.detached = true;
    else if (current && (token === "locked" || token.startsWith("locked "))) {
      current.lockedReason = token.slice("locked".length).trim() || "locked";
    } else if (current && (token === "prunable" || token.startsWith("prunable "))) {
      current.prunableReason = token.slice("prunable".length).trim() || "prunable";
    }
  }
  finish();
  return result;
}

/**
 * Branch names come from a dialog, so the check is about mistakes, not attacks (execFile never
 * touches a shell): no option-lookalikes, no traversal, and only characters git accepts unescaped.
 */
export const WORKTREE_BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

export class GitWorktreeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GitWorktreeError";
  }
}

function gitFailure(action: string, error: unknown): GitWorktreeError {
  const stderr = (error as { stderr?: string }).stderr?.trim();
  return new GitWorktreeError(stderr ? `${action}: ${stderr}` : `${action} failed`, { cause: error });
}

/** `<repo>/../<repo name>-wt/<branch slug>` — outside the repo, so agents never crawl their own
 *  sibling worktrees and `.gitignore` stays untouched. */
export function defaultWorktreePath(projectRootPath: string, branch: string): string {
  const slug = branch.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "worktree";
  return path.join(path.dirname(projectRootPath), `${path.basename(projectRootPath)}-wt`, slug);
}

export async function listGitWorktrees(repoRootPath: string): Promise<ParsedGitWorktree[]> {
  try {
    const result = await execFileAsync("git", ["-C", repoRootPath, "worktree", "list", "--porcelain", "-z"], {
      windowsHide: true,
      timeout: STATUS_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    return parseGitWorktreePorcelain(result.stdout).map((item) => ({ ...item, path: path.resolve(item.path) }));
  } catch (error) {
    throw gitFailure("git worktree list", error);
  }
}

export async function gitCommonDir(rootPath: string): Promise<string> {
  try {
    const result = await execFileAsync("git", ["-C", rootPath, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      windowsHide: true,
      timeout: STATUS_TIMEOUT_MS,
    });
    return path.resolve(result.stdout.trim());
  } catch (error) {
    throw gitFailure("git rev-parse --git-common-dir", error);
  }
}

export async function nextAvailableWorktreePath(projectRootPath: string, branch: string): Promise<string> {
  const base = defaultWorktreePath(projectRootPath, branch);
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const exists = await import("node:fs/promises").then(({ stat }) => stat(candidate).then(() => true, () => false));
    if (!exists) return candidate;
  }
}

export async function addGitWorktree(repoRootPath: string, worktreePath: string, branch: string): Promise<void> {
  if (!WORKTREE_BRANCH_PATTERN.test(branch) || branch.includes("..")) {
    throw new GitWorktreeError(`Branch name is invalid: ${branch}`);
  }
  try {
    await execFileAsync("git", ["-C", repoRootPath, "worktree", "add", "-b", branch, worktreePath], {
      windowsHide: true,
      timeout: ADD_TIMEOUT_MS,
    });
  } catch (error) {
    throw gitFailure("git worktree add", error);
  }
}

export async function addGitWorktreeRequest(
  repoRootPath: string,
  worktreePath: string,
  request: import("../../shared/worktree-types").WorktreeCreateRequest,
): Promise<void> {
  const branch = request.kind === "remote" ? request.localBranch : request.branch;
  if (!WORKTREE_BRANCH_PATTERN.test(branch) || branch.includes("..")) {
    throw new GitWorktreeError(`Branch name is invalid: ${branch}`);
  }
  const args =
    request.kind === "new"
      ? ["worktree", "add", "-b", request.branch, worktreePath, request.startPoint]
      : request.kind === "local"
        ? ["worktree", "add", worktreePath, request.branch]
        : ["worktree", "add", "-b", request.localBranch, worktreePath, request.remoteRef];
  try {
    await execFileAsync("git", ["-C", repoRootPath, ...args], { windowsHide: true, timeout: ADD_TIMEOUT_MS });
  } catch (error) {
    throw gitFailure("git worktree add", error);
  }
}

export async function unlockGitWorktree(repoRootPath: string, worktreePath: string): Promise<void> {
  try {
    await execFileAsync("git", ["-C", repoRootPath, "worktree", "unlock", worktreePath], {
      windowsHide: true,
      timeout: STATUS_TIMEOUT_MS,
    });
  } catch (error) {
    throw gitFailure("git worktree unlock", error);
  }
}

export async function pruneGitWorktrees(repoRootPath: string): Promise<void> {
  try {
    await execFileAsync("git", ["-C", repoRootPath, "worktree", "prune"], {
      windowsHide: true,
      timeout: STATUS_TIMEOUT_MS,
    });
  } catch (error) {
    throw gitFailure("git worktree prune", error);
  }
}

export async function removeGitWorktree(repoRootPath: string, worktreePath: string, force: boolean): Promise<void> {
  try {
    await execFileAsync(
      "git",
      ["-C", repoRootPath, "worktree", "remove", ...(force ? ["--force"] : []), worktreePath],
      { windowsHide: true, timeout: REMOVE_TIMEOUT_MS },
    );
  } catch (error) {
    throw gitFailure("git worktree remove", error);
  }
}

/** How many files stand uncommitted in the worktree — the gate the remove flow checks before
 *  touching anything. A worktree that no longer answers git counts as clean; removal will say why. */
export async function worktreeChangedFileCount(worktreePath: string): Promise<number> {
  try {
    const result = await execFileAsync("git", ["-C", worktreePath, "status", "--porcelain"], {
      windowsHide: true,
      timeout: STATUS_TIMEOUT_MS,
    });
    return countChangedFiles(result.stdout);
  } catch {
    return 0;
  }
}
