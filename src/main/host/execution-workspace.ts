import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import type { TaskProvider, TaskRole } from "../../shared/host-types";
import { validateTaskChoice, validateTaskId, validateTaskText } from "./task-validation";

const exec = promisify(execFile);
export interface TaskWorkspaceInput {
  ownedRoot: string; taskId: string; participantId: string; role: TaskRole;
  repositoryPath: string; expectedHead: string; brief: string;
  provider: TaskProvider; profileId: string;
}
export interface TaskExecutionWorkspace {
  directory: string; briefPath: string; repositoryPath: string; baseCommit: string;
  branch: string | null; provider: TaskProvider; profileId: string;
}
interface Manifest extends TaskExecutionWorkspace {
  schemaVersion: 1; taskId: string; participantId: string; role: TaskRole;
  briefHash: string; status: "preparing" | "prepared";
}
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function samePath(left: string, right: string): boolean { return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right; }
async function exists(file: string): Promise<boolean> { try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } }
async function ownedDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const stat = await lstat(directory); if (stat.isSymbolicLink() || !stat.isDirectory() || !samePath(await realpath(directory), directory)) throw new Error("Owned workspace directory is symbolic or replaced");
}
async function git(repository: string, ...args: string[]): Promise<string> {
  const result = await exec("git", ["-C", repository, ...args], { encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true }); return result.stdout.trim();
}
async function verifyRepository(repository: string, expectedHead: string): Promise<void> {
  const root = await realpath(await git(repository, "rev-parse", "--show-toplevel"));
  if (!samePath(root, repository)) throw new Error("Repository path must identify the canonical checkout root");
  if (await git(repository, "rev-parse", "--verify", "HEAD^{commit}") !== expectedHead) throw new Error("Repository HEAD does not match expected base commit");
}
function handoff(manifest: Manifest): TaskExecutionWorkspace {
  return { directory: manifest.directory, briefPath: manifest.briefPath, repositoryPath: manifest.repositoryPath, baseCommit: manifest.baseCommit, branch: manifest.branch, provider: manifest.provider, profileId: manifest.profileId };
}
async function saveManifest(file: string, manifest: Manifest): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`; await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o600 }); await rename(temporary, file);
}

/** Prepare only: selected profile handoff contains data, never shell commands or provider execution. */
export async function prepareTaskWorkspace(input: TaskWorkspaceInput): Promise<TaskExecutionWorkspace> {
  validateTaskId(input.taskId); validateTaskId(input.participantId); validateTaskText(input.ownedRoot); validateTaskText(input.repositoryPath); validateTaskText(input.brief, 100000);
  validateTaskChoice({ provider: input.provider, profileId: input.profileId });
  if (!["lead", "worker"].includes(input.role) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.expectedHead)) throw new Error("Invalid workspace role or full base commit");
  const repositoryPath = await realpath(input.repositoryPath); await verifyRepository(repositoryPath, input.expectedHead);
  await mkdir(path.resolve(input.ownedRoot), { recursive: true });
  const ownedRoot = await realpath(input.ownedRoot);
  const taskRoot = path.join(ownedRoot, digest(input.taskId)); await ownedDirectory(taskRoot);
  const container = path.join(taskRoot, digest(input.participantId));
  const release = await lockfile.lock(container, { realpath: false, retries: { retries: 50, factor: 1, minTimeout: 100, maxTimeout: 100 } });
  try {
    // Recheck under the per-participant lock; never traverse a replaced task/container symlink.
    await ownedDirectory(taskRoot);
    const present = await exists(container);
    if (present) {
      await ownedDirectory(container);
      const file = path.join(container, "workspace.json");
      if (!await exists(file)) throw new Error("Existing workspace has no MCW ownership manifest");
      const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid workspace ownership manifest");
      const manifest = JSON.parse(await readFile(file, "utf8")) as Manifest;
      const expected = { schemaVersion: 1, taskId: input.taskId, participantId: input.participantId, role: input.role, repositoryPath, baseCommit: input.expectedHead, provider: input.provider, profileId: input.profileId, briefHash: digest(input.brief), directory: input.role === "lead" ? container : path.join(container, "checkout"), briefPath: path.join(container, "brief.md") };
      for (const [key, value] of Object.entries(expected)) if (manifest[key as keyof Manifest] !== value) throw new Error("Workspace ownership/configuration conflict");
      if (Object.keys(manifest).some(key => ![...Object.keys(expected), "branch", "status"].includes(key)) || manifest.status !== "prepared" || (input.role === "lead" ? manifest.branch !== null : typeof manifest.branch !== "string" || !/^mcw-v2\/[a-f0-9-]+$/.test(manifest.branch))) throw new Error("Incomplete or invalid owned workspace; inspect before recovering");
      const briefStat = await lstat(manifest.briefPath); if (!briefStat.isFile() || briefStat.isSymbolicLink() || digest(await readFile(manifest.briefPath, "utf8")) !== manifest.briefHash) throw new Error("Workspace brief was modified");
      await ownedDirectory(manifest.directory);
      if (input.role === "worker") { await verifyRepository(manifest.directory, input.expectedHead); if (await git(manifest.directory, "symbolic-ref", "--short", "HEAD") !== manifest.branch) throw new Error("Worker branch differs from owned branch"); }
      return handoff(manifest);
    }
    await mkdir(container); await ownedDirectory(container);
    const manifest: Manifest = { schemaVersion: 1, status: "preparing", taskId: input.taskId, participantId: input.participantId, role: input.role, repositoryPath, baseCommit: input.expectedHead, provider: input.provider, profileId: input.profileId, briefHash: digest(input.brief), directory: input.role === "lead" ? container : path.join(container, "checkout"), briefPath: path.join(container, "brief.md"), branch: input.role === "lead" ? null : `mcw-v2/${randomUUID()}` };
    const file = path.join(container, "workspace.json"); await saveManifest(file, manifest);
    await writeFile(manifest.briefPath, input.brief, { flag: "wx", mode: 0o600 });
    if (input.role === "worker") {
      // A dirty primary is safe: worktree uses only the explicit verified commit, never copied files.
      await verifyRepository(repositoryPath, input.expectedHead);
      await git(repositoryPath, "-c", `core.hooksPath=${path.join(ownedRoot, "disabled-hooks")}`, "worktree", "add", "-b", manifest.branch!, "--", manifest.directory, input.expectedHead);
      await verifyRepository(manifest.directory, input.expectedHead);
    }
    manifest.status = "prepared"; await saveManifest(file, manifest); return handoff(manifest);
  } finally { await release(); }
}
