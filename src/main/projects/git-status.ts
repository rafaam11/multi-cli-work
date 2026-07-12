import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitStatusResult } from "../../shared/api-types";

const execFileAsync = promisify(execFile);

/** Counts non-blank `git status --porcelain` lines, i.e. changed/untracked files. */
export function countChangedFiles(porcelainOutput: string): number {
  return porcelainOutput.split("\n").filter((line) => line.trim().length > 0).length;
}

/**
 * A folder that is not a git repository (or has no git on PATH) is a normal, expected case for
 * this app, not a failure — so every failure mode collapses to `isRepo: false` rather than a throw.
 */
export async function readGitStatus(rootPath: string): Promise<GitStatusResult> {
  try {
    const [branchResult, statusResult] = await Promise.all([
      execFileAsync("git", ["-C", rootPath, "rev-parse", "--abbrev-ref", "HEAD"], { windowsHide: true, timeout: 5_000 }),
      execFileAsync("git", ["-C", rootPath, "status", "--porcelain"], { windowsHide: true, timeout: 5_000 }),
    ]);
    return {
      isRepo: true,
      branch: branchResult.stdout.trim() || null,
      changedFileCount: countChangedFiles(statusResult.stdout),
    };
  } catch {
    return { isRepo: false, branch: null, changedFileCount: 0 };
  }
}
