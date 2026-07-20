import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  GitCommitDetails,
  GitCommitFile,
  GitCommitFileDiff,
  GitGraphCommit,
  GitGraphPage,
  GitGraphRef,
} from "../../shared/api-types";

const execFileAsync = promisify(execFile);
const FIELD = "\x1f";
const RECORD = "\x1e";
const QUERY_TIMEOUT_MS = 15_000;
const MUTATE_TIMEOUT_MS = 60_000;
const MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const MAX_DIFF_CHARS = 1024 * 1024;
const HASH_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export class GitGraphError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GitGraphError";
  }
}

async function runGit(rootPath: string, args: string[], timeout = QUERY_TIMEOUT_MS): Promise<string> {
  const result = await execFileAsync("git", ["-C", rootPath, ...args], {
    windowsHide: true,
    timeout,
    maxBuffer: MAX_BUFFER_BYTES,
    encoding: "utf8",
  });
  return result.stdout;
}

async function runGitBuffer(rootPath: string, args: string[]): Promise<Buffer> {
  const result = await execFileAsync("git", ["-C", rootPath, ...args], {
    windowsHide: true,
    timeout: QUERY_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_BYTES,
    encoding: "buffer",
  });
  return result.stdout as Buffer;
}

function failure(action: string, error: unknown, recovery?: string): GitGraphError {
  const stderr = (error as { stderr?: string | Buffer }).stderr;
  const detail = typeof stderr === "string" ? stderr.trim() : stderr?.toString("utf8").trim();
  return new GitGraphError(`${detail || `${action} failed`}${recovery ? `\n\n${recovery}` : ""}`, { cause: error });
}

export function assertFullCommitHash(hash: string): void {
  if (!HASH_PATTERN.test(hash)) throw new GitGraphError("Commit hash must be a full SHA-1 or SHA-256 hash");
}

export function parseGitLog(output: string): Omit<GitGraphCommit, "refs">[] {
  return output
    .split(RECORD)
    .map((record) => record.replace(/^\r?\n|\r?\n$/g, ""))
    .filter(Boolean)
    .map((record) => {
      const [hash = "", parents = "", authorName = "", authoredAt = "", subject = ""] = record.split(FIELD);
      return { hash, parents: parents ? parents.split(" ") : [], authorName, authoredAt, subject };
    });
}

export function parseGitRefs(output: string): Map<string, GitGraphRef[]> {
  const refs = new Map<string, GitGraphRef[]>();
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const [objectHash = "", peeledHash = "", fullName = ""] = line.split(FIELD);
    const hash = peeledHash || objectHash;
    let ref: GitGraphRef | null = null;
    if (fullName.startsWith("refs/heads/")) ref = { fullName, name: fullName.slice(11), kind: "local" };
    else if (fullName.startsWith("refs/remotes/")) ref = { fullName, name: fullName.slice(13), kind: "remote" };
    else if (fullName.startsWith("refs/tags/")) ref = { fullName, name: fullName.slice(10), kind: "tag" };
    if (hash && ref) refs.set(hash, [...(refs.get(hash) ?? []), ref]);
  }
  return refs;
}

export function parseNameStatus(output: string): GitCommitFile[] {
  const fields = output.split("\0");
  const files: GitCommitFile[] = [];
  for (let index = 0; index < fields.length; ) {
    const rawStatus = fields[index++];
    if (!rawStatus) continue;
    const status = rawStatus[0];
    if (status === "R" || status === "C") {
      const oldPath = fields[index++] ?? "";
      const path = fields[index++] ?? "";
      if (path) files.push({ status: "R", oldPath, path });
    } else {
      const path = fields[index++] ?? "";
      if (path) files.push({ status: status === "A" || status === "D" ? status : "M", path });
    }
  }
  return files;
}

async function headRef(rootPath: string): Promise<{ hash: string; name: string } | null> {
  try {
    const hash = (await runGit(rootPath, ["rev-parse", "HEAD"])).trim();
    let name = "HEAD";
    try {
      name = (await runGit(rootPath, ["symbolic-ref", "--quiet", "--short", "HEAD"])).trim() || "HEAD";
    } catch {
      // Detached HEAD is represented by its literal name.
    }
    return { hash, name };
  } catch {
    return null;
  }
}

export async function listGitGraph(rootPath: string, options: { offset: number; limit: number }): Promise<GitGraphPage> {
  const offset = Math.max(0, Math.trunc(options.offset));
  const limit = Math.min(500, Math.max(1, Math.trunc(options.limit)));
  const format = ["%H", "%P", "%an", "%aI", "%s"].join("%x1f") + "%x1e";
  try {
    const [logOutput, refsOutput, head] = await Promise.all([
      runGit(rootPath, ["log", "--all", "--topo-order", `--skip=${offset}`, `--max-count=${limit + 1}`, `--format=${format}`]),
      runGit(rootPath, ["for-each-ref", `--format=%(objectname)${FIELD}%(*objectname)${FIELD}%(refname)`]),
      headRef(rootPath),
    ]);
    const parsed = parseGitLog(logOutput);
    const refs = parseGitRefs(refsOutput);
    if (head) refs.set(head.hash, [{ name: head.name, fullName: "HEAD", kind: "head" }, ...(refs.get(head.hash) ?? [])]);
    return {
      commits: parsed.slice(0, limit).map((commit) => ({ ...commit, refs: refs.get(commit.hash) ?? [] })),
      offset,
      limit,
      hasMore: parsed.length > limit,
    };
  } catch (error) {
    throw failure("git log", error);
  }
}

async function commitMetadata(rootPath: string, hash: string): Promise<Omit<GitCommitDetails, "files">> {
  assertFullCommitHash(hash);
  const format = ["%H", "%P", "%s", "%B", "%an", "%ae", "%aI", "%cn", "%ce", "%cI"].join(FIELD) + RECORD;
  try {
    const output = await runGit(rootPath, ["show", "--no-patch", `--format=${format}`, hash]);
    const [record = ""] = output.split(RECORD);
    const [actualHash = "", parents = "", subject = "", message = "", authorName = "", authorEmail = "", authoredAt = "", committerName = "", committerEmail = "", committedAt = ""] = record.replace(/^\r?\n/, "").split(FIELD);
    if (actualHash !== hash) throw new GitGraphError("Commit does not exist in this repository");
    return { hash, parents: parents ? parents.split(" ") : [], subject, message: message.trimEnd(), authorName, authorEmail, authoredAt, committerName, committerEmail, committedAt };
  } catch (error) {
    if (error instanceof GitGraphError) throw error;
    throw failure("git show", error);
  }
}

async function changedFiles(rootPath: string, hash: string, parents: string[]): Promise<GitCommitFile[]> {
  try {
    const args = parents.length
      ? ["diff", "--name-status", "-z", "-M", parents[0], hash]
      : ["diff-tree", "--root", "--no-commit-id", "-r", "--name-status", "-z", "-M", hash];
    return parseNameStatus(await runGit(rootPath, args));
  } catch (error) {
    throw failure("git diff", error);
  }
}

export async function readGitCommitDetails(rootPath: string, hash: string): Promise<GitCommitDetails> {
  const metadata = await commitMetadata(rootPath, hash);
  return { ...metadata, files: await changedFiles(rootPath, hash, metadata.parents) };
}

async function readBlob(rootPath: string, revision: string, path: string): Promise<Buffer> {
  try {
    return await runGitBuffer(rootPath, ["show", `${revision}:${path}`]);
  } catch {
    return Buffer.alloc(0);
  }
}

export async function readGitCommitFileDiff(rootPath: string, hash: string, path: string): Promise<GitCommitFileDiff> {
  const details = await readGitCommitDetails(rootPath, hash);
  const file = details.files.find((candidate) => candidate.path === path);
  if (!file) throw new GitGraphError("Path is not changed by this commit");
  const numstatArgs = details.parents[0]
    ? ["diff", "--numstat", "-z", details.parents[0], hash, "--", file.path]
    : ["diff-tree", "--root", "--no-commit-id", "-r", "--numstat", "-z", hash, "--", file.path];
  const [originalBuffer, modifiedBuffer, numstat] = await Promise.all([
    details.parents[0] ? readBlob(rootPath, details.parents[0], file.oldPath ?? file.path) : Buffer.alloc(0),
    file.status === "D" ? Promise.resolve(Buffer.alloc(0)) : readBlob(rootPath, hash, file.path),
    runGit(rootPath, numstatArgs),
  ]);
  const binary = numstat.startsWith("-\t-\t") || originalBuffer.includes(0) || modifiedBuffer.includes(0);
  const original = binary ? "" : originalBuffer.toString("utf8");
  const modified = binary ? "" : modifiedBuffer.toString("utf8");
  const truncated = original.length > MAX_DIFF_CHARS || modified.length > MAX_DIFF_CHARS;
  return {
    ...file,
    hash,
    original: truncated ? original.slice(0, MAX_DIFF_CHARS) : original,
    modified: truncated ? modified.slice(0, MAX_DIFF_CHARS) : modified,
    binary,
    truncated,
  };
}

async function validateRef(rootPath: string, name: string, kind: "branch" | "tag"): Promise<void> {
  if (!name.trim() || name !== name.trim()) throw new GitGraphError(`${kind} name is invalid`);
  try {
    await runGit(rootPath, kind === "branch" ? ["check-ref-format", "--branch", name] : ["check-ref-format", `refs/tags/${name}`]);
  } catch (error) {
    throw failure(`git check-ref-format (${kind})`, error);
  }
}

export async function createGitGraphBranch(rootPath: string, hash: string, name: string, checkout: boolean): Promise<void> {
  assertFullCommitHash(hash);
  await validateRef(rootPath, name, "branch");
  try {
    await runGit(rootPath, ["branch", name, hash], MUTATE_TIMEOUT_MS);
    if (checkout) await runGit(rootPath, ["checkout", name], MUTATE_TIMEOUT_MS);
  } catch (error) {
    throw failure(checkout ? "git branch/checkout" : "git branch", error);
  }
}

export async function createGitGraphTag(rootPath: string, hash: string, name: string): Promise<void> {
  assertFullCommitHash(hash);
  await validateRef(rootPath, name, "tag");
  try {
    await runGit(rootPath, ["tag", name, hash], MUTATE_TIMEOUT_MS);
  } catch (error) {
    throw failure("git tag", error);
  }
}

async function assertNonMerge(rootPath: string, hash: string): Promise<void> {
  const details = await commitMetadata(rootPath, hash);
  if (details.parents.length > 1) throw new GitGraphError("Merge commits require a mainline parent and are not supported here");
}

export async function cherryPickGitCommit(rootPath: string, hash: string): Promise<void> {
  await assertNonMerge(rootPath, hash);
  try {
    await runGit(rootPath, ["cherry-pick", hash], MUTATE_TIMEOUT_MS);
  } catch (error) {
    throw failure("git cherry-pick", error, "터미널에서 충돌을 해결한 뒤 git cherry-pick --continue 또는 git cherry-pick --abort를 실행하세요.");
  }
}

export async function revertGitCommit(rootPath: string, hash: string): Promise<void> {
  await assertNonMerge(rootPath, hash);
  try {
    await runGit(rootPath, ["revert", "--no-edit", hash], MUTATE_TIMEOUT_MS);
  } catch (error) {
    throw failure("git revert", error, "터미널에서 충돌을 해결한 뒤 git revert --continue 또는 git revert --abort를 실행하세요.");
  }
}
