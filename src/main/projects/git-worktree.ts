import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { countChangedFiles } from "./git-status";

const execFileAsync = promisify(execFile);

/** `git worktree add` checks files out, so it gets far more time than a status query. */
const ADD_TIMEOUT_MS = 60_000;
const REMOVE_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 5_000;

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
