import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitDiffResult } from "../../shared/api-types";

const execFileAsync = promisify(execFile);

/** More than this is unreadable in a dialog anyway; the view says it was cut. */
const MAX_DIFF_CHARS = 1024 * 1024;
/** execFile's default 1 MiB buffer would turn a big diff into a spurious "not a repo". */
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/**
 * Follows `git-status.ts`: a folder that is not a repo (or a repo with no commits yet) is a normal
 * case for this app, so every failure collapses to `isRepo: false` instead of a throw.
 */
export async function readGitDiff(rootPath: string): Promise<GitDiffResult> {
  try {
    const [diffResult, untrackedResult] = await Promise.all([
      execFileAsync("git", ["-C", rootPath, "diff", "HEAD"], {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: MAX_BUFFER_BYTES,
      }),
      execFileAsync("git", ["-C", rootPath, "ls-files", "--others", "--exclude-standard"], {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: MAX_BUFFER_BYTES,
      }),
    ]);
    const truncated = diffResult.stdout.length > MAX_DIFF_CHARS;
    return {
      isRepo: true,
      diff: truncated ? diffResult.stdout.slice(0, MAX_DIFF_CHARS) : diffResult.stdout,
      untracked: untrackedResult.stdout.split("\n").filter((line) => line.trim().length > 0),
      truncated,
    };
  } catch {
    return { isRepo: false, diff: "", untracked: [], truncated: false };
  }
}
