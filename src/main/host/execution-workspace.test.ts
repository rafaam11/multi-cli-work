// @vitest-environment node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { prepareTaskWorkspace } from "./execution-workspace";
const exec = promisify(execFile);
// Each case starts real Git processes; concurrent repository-wide suites contend for process slots.
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  // Manually authored legacy manifests must use the real paths written by production, even under a CI temp alias.
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "mcw-workspace-"))); directories.push(directory);
  const repositoryPath = path.join(directory, "repository"); await mkdir(repositoryPath);
  const git = (...args: string[]) => exec("git", ["-C", repositoryPath, ...args]);
  await git("init"); await git("config", "user.email", "test@example.invalid"); await git("config", "user.name", "Test");
  await git("config", "core.autocrlf", "false");
  await writeFile(path.join(repositoryPath, "source.txt"), "base\n"); await git("add", "source.txt"); await git("commit", "-m", "base");
  const expectedHead = (await git("rev-parse", "HEAD")).stdout.trim();
  const input = { ownedRoot: path.join(directory, "owned"), taskId: "task-a", participantId: "worker-a", role: "worker" as const, repositoryPath, expectedHead, brief: "Implement safely\nKeep evidence", provider: "codex" as const, profileId: "selected" };
  return { directory, repositoryPath, input, git };
}

it("gives lead a dedicated brief directory and passes selected provider/profile without starting it", async () => {
  const { input, repositoryPath, git } = await fixture();
  const brief = "full task context\n".repeat(1500);
  const workspace = await prepareTaskWorkspace({ ...input, brief, role: "lead", provider: "claude", profileId: "lead-choice" });
  expect(workspace.directory).not.toBe(repositoryPath);
  expect(await readFile(workspace.briefPath, "utf8")).toBe(brief);
  expect(workspace).toMatchObject({ provider: "claude", profileId: "lead-choice", baseCommit: input.expectedHead, branch: null });
  expect((await git("worktree", "list", "--porcelain")).stdout.split("worktree ")).toHaveLength(2);
});

it("isolates writing workers on unique MCW-owned branches from the verified base without touching dirty primary", async () => {
  const { input, repositoryPath, git } = await fixture(); await writeFile(path.join(repositoryPath, "source.txt"), "unsaved primary\n");
  const first = await prepareTaskWorkspace(input); const second = await prepareTaskWorkspace({ ...input, participantId: "worker-b" });
  expect(first.branch).not.toBe(second.branch);
  expect(await readFile(path.join(first.directory, "source.txt"), "utf8")).toBe("base\n");
  expect(await readFile(path.join(repositoryPath, "source.txt"), "utf8")).toBe("unsaved primary\n");
  expect((await exec("git", ["-C", first.directory, "rev-parse", "HEAD"])).stdout.trim()).toBe(input.expectedHead);
  expect((await git("status", "--porcelain")).stdout).toContain("source.txt");
  expect(await prepareTaskWorkspace(input)).toEqual(first);
});

it("prepares a worker under a realistic long Windows application data root",async()=>{
  const {input,directory}=await fixture();
  const ownedRoot=path.join(directory,"Multi CLI Work Preview-v2","host","task-workspaces");
  const workspace=await prepareTaskWorkspace({...input,ownedRoot});
  expect(await readFile(path.join(workspace.directory,"source.txt"),"utf8")).toBe("base\n");
  expect(await prepareTaskWorkspace({...input,ownedRoot})).toEqual(workspace);
});

it("reuses the full-length owned layout created by earlier previews without moving it",async()=>{
  const {input}=await fixture();
  const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
  const container=path.join(input.ownedRoot,digest(input.taskId),digest(input.participantId));
  await mkdir(container,{recursive:true});
  const workspace={directory:container,briefPath:path.join(container,"brief.md"),repositoryPath:input.repositoryPath,baseCommit:input.expectedHead,branch:null,provider:input.provider,profileId:input.profileId};
  await writeFile(workspace.briefPath,input.brief);
  await writeFile(path.join(container,"workspace.json"),JSON.stringify({...workspace,schemaVersion:1,status:"prepared",taskId:input.taskId,participantId:input.participantId,role:"lead",briefHash:digest(input.brief)}));
  expect(await prepareTaskWorkspace({...input,role:"lead"})).toEqual(workspace);
  expect(await readdir(input.ownedRoot)).toEqual([digest(input.taskId)]);
});

it("refuses wrong base, nested checkout, conflicting reused workspace and edited brief", async () => {
  const { input, repositoryPath } = await fixture();
  await expect(prepareTaskWorkspace({ ...input, expectedHead: "0".repeat(40) })).rejects.toThrow(/base|HEAD/i);
  const nested = path.join(repositoryPath, "subdirectory"); await mkdir(nested);
  await expect(prepareTaskWorkspace({ ...input, repositoryPath: nested })).rejects.toThrow(/checkout|root/i);
  const prepared = await prepareTaskWorkspace(input);
  await expect(prepareTaskWorkspace({ ...input, profileId: "different" })).rejects.toThrow(/conflict/i);
  await writeFile(prepared.briefPath, "edited");
  await expect(prepareTaskWorkspace(input)).rejects.toThrow(/brief/i);
});

it("serializes duplicate preparation and refuses preexisting unowned destinations", async () => {
  const { input } = await fixture();
  const [first, second] = await Promise.all([prepareTaskWorkspace(input), prepareTaskWorkspace(input)]);
  expect(second).toEqual(first);
  const container = path.dirname(first.directory); await rm(path.join(container, "workspace.json"));
  await expect(prepareTaskWorkspace(input)).rejects.toThrow(/owned|existing/i);
  expect(await readdir(first.directory)).toContain("source.txt");
});

it("does not follow a replaced owned task directory symlink", async () => {
  const { input, directory } = await fixture(); const prepared = await prepareTaskWorkspace({ ...input, role: "lead" });
  const taskRoot = path.dirname(prepared.directory); const moved = path.join(directory, "moved");
  // Lead's directory is its participant container; task parent may be replaced while host is offline.
  const { rename } = await import("node:fs/promises"); await rename(taskRoot, moved);
  await symlink(moved, taskRoot, process.platform === "win32" ? "junction" : "dir");
  await expect(prepareTaskWorkspace({ ...input, role: "lead" })).rejects.toThrow(/symbolic|symlink|owned/i);
});
