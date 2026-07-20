import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitChangeEntry, GitCommitRequest, GitFileOriginal, GitPanelData } from "../../shared/api-types";
import { WORKTREE_BRANCH_PATTERN } from "./git-worktree";

const execFileAsync = promisify(execFile);

const QUERY_TIMEOUT_MS = 5_000;
/** Checkout and commit touch the working tree, so they get far more time than a status query. */
const MUTATE_TIMEOUT_MS = 30_000;
/** Push/fetch/pull wait on the network, not the disk. */
const REMOTE_TIMEOUT_MS = 120_000;
/** execFile's default 1 MiB buffer would misreport a huge status as a git failure. */
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

export class GitCommandError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GitCommandError";
  }
}

function gitFailure(action: string, error: unknown): GitCommandError {
  const stderr = (error as { stderr?: string }).stderr?.trim();
  return new GitCommandError(stderr ? `${action}: ${stderr}` : `${action} failed`, { cause: error });
}

function assertBranchName(branch: string): void {
  if (!WORKTREE_BRANCH_PATTERN.test(branch) || branch.includes("..")) {
    throw new GitCommandError(`Branch name is invalid: ${branch}`);
  }
}

async function git(rootPath: string, args: string[], timeout: number): Promise<string> {
  const result = await execFileAsync("git", ["-C", rootPath, ...args], {
    windowsHide: true,
    timeout,
    maxBuffer: MAX_BUFFER_BYTES,
  });
  return result.stdout;
}

export interface ParsedGitStatus {
  currentBranch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  changes: GitChangeEntry[];
}

/** Collapses porcelain's separate index/worktree columns to the one badge the panel shows. */
function changeStatus(xy: string): GitChangeEntry["status"] {
  const significant = xy[1] && xy[1] !== "." ? xy[1] : (xy[0] ?? ".");
  switch (significant) {
    case "A":
      return "A";
    case "D":
      return "D";
    case "R":
      return "R";
    case "C":
      return "A";
    case "U":
      return "U";
    default:
      // M, T (type change), and anything git grows later all read as "modified" here.
      return "M";
  }
}

/**
 * Parses `git status --porcelain=v2 --branch -z` output. The `-z` form separates records with NUL
 * and never quotes paths, so this is the only spelling that survives spaces and non-ASCII names.
 */
export function parseGitStatusV2(output: string): ParsedGitStatus {
  const records = output.split("\0");
  const changes: GitChangeEntry[] = [];
  let currentBranch: string | null = null;
  let upstream: string | null = null;
  let ahead: number | null = null;
  let behind: number | null = null;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    if (record.startsWith("# branch.head ")) {
      const name = record.slice("# branch.head ".length);
      currentBranch = name === "(detached)" ? null : name;
    } else if (record.startsWith("# branch.upstream ")) {
      upstream = record.slice("# branch.upstream ".length);
    } else if (record.startsWith("# branch.ab ")) {
      const match = /^\+(\d+) -(\d+)$/.exec(record.slice("# branch.ab ".length));
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    } else if (record.startsWith("? ")) {
      changes.push({ path: record.slice(2), status: "?" });
    } else if (record.startsWith("1 ")) {
      const fields = record.split(" ");
      changes.push({ path: fields.slice(8).join(" "), status: changeStatus(fields[1] ?? "..") });
    } else if (record.startsWith("2 ")) {
      // A rename's original path travels as the following NUL-separated record.
      const fields = record.split(" ");
      const renamedFrom = records[index + 1] ?? "";
      index += 1;
      changes.push({ path: fields.slice(9).join(" "), status: "R", renamedFrom });
    } else if (record.startsWith("u ")) {
      const fields = record.split(" ");
      changes.push({ path: fields.slice(10).join(" "), status: "U" });
    }
  }
  return { currentBranch, upstream, ahead, behind, changes };
}

/**
 * Follows `git-status.ts`: a folder that is not a repo is a normal case for this app, so every
 * read failure collapses to `isRepo: false` instead of a throw.
 */
export async function readGitPanelData(rootPath: string): Promise<GitPanelData> {
  try {
    const [statusOutput, branchesOutput] = await Promise.all([
      git(rootPath, ["status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"], QUERY_TIMEOUT_MS),
      git(rootPath, ["for-each-ref", "refs/heads", "--sort=-committerdate", "--format=%(refname:short)"], QUERY_TIMEOUT_MS),
    ]);
    return {
      isRepo: true,
      ...parseGitStatusV2(statusOutput),
      branches: branchesOutput
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    };
  } catch {
    return { isRepo: false, currentBranch: null, upstream: null, ahead: null, behind: null, branches: [], changes: [] };
  }
}

export async function checkoutGitBranch(rootPath: string, branch: string): Promise<void> {
  assertBranchName(branch);
  try {
    await git(rootPath, ["checkout", branch], MUTATE_TIMEOUT_MS);
  } catch (error) {
    throw gitFailure("git checkout", error);
  }
}

export async function createGitBranch(rootPath: string, branch: string): Promise<void> {
  assertBranchName(branch);
  try {
    await git(rootPath, ["checkout", "-b", branch], MUTATE_TIMEOUT_MS);
  } catch (error) {
    throw gitFailure("git checkout -b", error);
  }
}

/**
 * Commits exactly the checked files via a pathspec commit, leaving whatever the user staged by
 * hand for the unchecked files untouched. Status is re-read first so the commit reflects the repo
 * as it is now — a path whose change disappeared since the panel drew is an error, not a no-op.
 */
export async function commitGitFiles(rootPath: string, request: GitCommitRequest): Promise<void> {
  const summary = request.summary.trim();
  const description = request.description.trim();
  if (!summary) throw new GitCommandError("Commit summary must not be empty");
  if (request.paths.length === 0) throw new GitCommandError("No files are selected for the commit");

  let changes: GitChangeEntry[];
  try {
    const statusOutput = await git(rootPath, ["status", "--porcelain=v2", "--untracked-files=all", "-z"], QUERY_TIMEOUT_MS);
    changes = parseGitStatusV2(statusOutput).changes;
  } catch (error) {
    throw gitFailure("git status", error);
  }
  const changeByPath = new Map(changes.map((change) => [change.path, change]));
  const stale = request.paths.filter((path) => !changeByPath.has(path));
  if (stale.length > 0) {
    throw new GitCommandError(`No changes left to commit for: ${stale.join(", ")} — refresh the panel`);
  }

  const untracked = request.paths.filter((path) => changeByPath.get(path)?.status === "?");
  // Renames need both sides in the pathspec, or the commit would record only half the move.
  const pathspecs = [
    ...new Set(
      request.paths.flatMap((path) => {
        const renamedFrom = changeByPath.get(path)?.renamedFrom;
        return renamedFrom ? [path, renamedFrom] : [path];
      }),
    ),
  ];
  try {
    if (untracked.length > 0) await git(rootPath, ["add", "--", ...untracked], MUTATE_TIMEOUT_MS);
    const messageArgs = description ? ["-m", summary, "-m", description] : ["-m", summary];
    await git(rootPath, ["commit", ...messageArgs, "--", ...pathspecs], MUTATE_TIMEOUT_MS);
  } catch (error) {
    throw gitFailure("git commit", error);
  }
}

/** More than this is unreadable in a diff pane anyway; the view says it was cut. */
const MAX_ORIGINAL_CHARS = 1024 * 1024;

/**
 * The HEAD-side content for the diff pane. A path that did not exist in HEAD (new or untracked
 * file) is a normal case and reads as empty, matching how the diff should render it.
 */
export async function readGitFileOriginal(rootPath: string, relativePath: string): Promise<GitFileOriginal> {
  try {
    // `git show HEAD:<path>` resolves the path inside the repository only — `..` escapes are
    // rejected by git itself, so the renderer cannot read outside the worktree through this.
    const content = await git(rootPath, ["show", `HEAD:${relativePath}`], QUERY_TIMEOUT_MS);
    const truncated = content.length > MAX_ORIGINAL_CHARS;
    return { content: truncated ? content.slice(0, MAX_ORIGINAL_CHARS) : content, truncated };
  } catch {
    return { content: "", truncated: false };
  }
}

export async function pushCurrentBranch(rootPath: string): Promise<void> {
  let hasUpstream = true;
  try {
    await git(rootPath, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], QUERY_TIMEOUT_MS);
  } catch {
    hasUpstream = false;
  }
  try {
    if (hasUpstream) {
      await git(rootPath, ["push"], REMOTE_TIMEOUT_MS);
      return;
    }
    const branch = (await git(rootPath, ["rev-parse", "--abbrev-ref", "HEAD"], QUERY_TIMEOUT_MS)).trim();
    if (!branch || branch === "HEAD") throw new GitCommandError("Cannot publish a detached HEAD");
    await git(rootPath, ["push", "-u", "origin", branch], REMOTE_TIMEOUT_MS);
  } catch (error) {
    if (error instanceof GitCommandError) throw error;
    throw gitFailure("git push", error);
  }
}

export async function fetchGitRemote(rootPath: string): Promise<void> {
  try {
    await git(rootPath, ["fetch", "--prune"], REMOTE_TIMEOUT_MS);
  } catch (error) {
    throw gitFailure("git fetch", error);
  }
}

export async function pullGitFastForward(rootPath: string): Promise<void> {
  try {
    await git(rootPath, ["pull", "--ff-only"], REMOTE_TIMEOUT_MS);
  } catch (error) {
    throw gitFailure("git pull --ff-only", error);
  }
}
