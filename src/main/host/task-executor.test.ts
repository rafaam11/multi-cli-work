// @vitest-environment node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { TaskStore } from "./task-store";
import { TaskExecutor } from "./task-executor";
import type { HostTerminalService } from "./gateway";
const exec = promisify(execFile), directories: string[] = [];
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcw-executor-")); directories.push(directory);
  const repositoryPath = path.join(directory, "repository"); await mkdir(repositoryPath);
  const git = (...args: string[]) => exec("git", ["-C", repositoryPath, ...args]);
  await git("init"); await git("config", "user.email", "test@example.invalid"); await git("config", "user.name", "Test");
  await writeFile(path.join(repositoryPath, "source.txt"), "base\n"); await git("add", "."); await git("commit", "-m", "base");
  const expectedHead = (await git("rev-parse", "HEAD")).stdout.trim();
  const store = new TaskStore({ directory, hostId: "local" });
  const task = await store.createTask({ title: "Build", brief: "Keep evidence", lead: { provider: "codex", profileId: "selected", hostId: "local" }, workers: [{ provider: "claude", profileId: "selected-worker" }] });
  const sessions: Record<string, unknown>[] = [];
  const create = vi.fn(async (input: Record<string, unknown>) => { const session = { ...input, id: input.sessionId, delivery: "delivered", status: "working", connected: true }; sessions.push(session); return session; });
  const terminals = { create, list: async () => sessions } as unknown as HostTerminalService;
  const mcpClientPath = path.join(directory, "client.js"); await writeFile(mcpClientPath, "// fixture");
  const executor = new TaskExecutor({ directory, store, terminals, issueTaskToken: async () => "private-capability", gatewayUrl: () => "http://127.0.0.1:12345", mcpClientPath });
  const input = { repositoryPath, expectedHead, profiles: task.participants.map(member => ({ participantId: member.id, executable: process.execPath, profile: { id: member.profileId, agentId: member.provider, name: "Selected", model: "chosen-model", effort: "high" } })) };
  return { directory, repositoryPath, store, task, create, sessions, executor, input, git };
}
it("launches selected profiles once in isolated directories with task-scoped MCP, leaving the base unchanged", async () => {
  const { directory, repositoryPath, store, task, create, executor, input, git } = await setup();
  await writeFile(path.join(repositoryPath, "source.txt"), "user edit\n");
  await executor.start(task.id, input);
  expect(create).toHaveBeenCalledTimes(2);
  const commands = create.mock.calls.map(([command]) => command);
  expect(commands.every(command => command.cwd !== repositoryPath)).toBe(true);
  expect(commands[0].cwd).not.toBe(commands[1].cwd);
  for (const command of commands) expect(command.args).toContain("--model=chosen-model");
  const claudeArgs=commands[1].args as string[];
  // Claude consumes all subsequent non-option arguments as MCP config files.
  // The prompt must follow a real option boundary, including default profiles.
  const configIndex=claudeArgs.indexOf("--mcp-config");
  expect(claudeArgs[configIndex+2]).toBe("--strict-mcp-config");
  for (const [index, command] of commands.entries()) {
    const participant = task.participants[index];
    expect(command.env).toMatchObject({
      MULTI_CLI_WORK_SESSION_ID: participant.attempt.id,
      MULTI_CLI_WORK_GENERATION: `${participant.attempt.id}-${participant.attempt.generation}`,
      MCW_TASK_ID: task.id, MCW_PARTICIPANT_ID: participant.id, MCW_TASK_ROLE: participant.role,
      MCW_TASK_OWNER_HOST_ID: task.ownerHostId, MCW_RUNTIME: "v2",
    });
    const briefPath = (command.env as Record<string, string>).MULTI_CLI_WORK_PROJECT_BRIEF;
    expect(await readFile(briefPath, "utf8")).toContain(task.brief);
    expect(command.env).not.toHaveProperty("MCW_TASK_TOKEN");
    expect((command.args as string[]).some(arg => arg.includes("task_wait"))).toBe(true);
  }
  expect(JSON.stringify(commands)).not.toMatch(/jk-mcp|MULTI_CLI_WORK_CONTROL/);
  expect(JSON.stringify(commands)).not.toContain("private-capability");
  for (const member of task.participants) {
    const config=JSON.parse(await readFile(path.join(directory,"task-mcp",`${member.attempt.id}.json`),"utf8")).mcpServers.mcw_task;
    expect(config.env).not.toHaveProperty("MCW_TASK_TOKEN");
    const connectionFile=config.args[config.args.indexOf("--connection-file")+1];
    expect(JSON.parse(await readFile(connectionFile,"utf8"))).toEqual({endpoint:"http://127.0.0.1:12345/mcp",token:"private-capability"});
  }
  expect((await store.inspect(task.id)).participants.every(member => member.attempt.delivery === "delivered")).toBe(true);
  expect((await git("rev-parse", "HEAD")).stdout.trim()).toBe(input.expectedHead);
  expect(await readFile(path.join(repositoryPath, "source.txt"), "utf8")).toBe("user edit\n");
  await expect(executor.start(task.id, input)).rejects.toThrow(/already attempted/);
  expect(create).toHaveBeenCalledTimes(2);
});
it("refuses a changed base or profile before any command is admitted", async () => {
  const { task, executor, input, create } = await setup();
  await expect(executor.start(task.id, { ...input, expectedHead: "a".repeat(40) })).rejects.toThrow();
  await expect(executor.start(task.id, { ...input, profiles: input.profiles.map(value => ({ ...value, profile: { ...value.profile, id: "unselected" } })) })).rejects.toThrow(/user selection/);
  expect(create).not.toHaveBeenCalled();
});
it("preserves ambiguous delivery and never launches later workers or retries", async () => {
  const { task, store, executor, input, create } = await setup();
  create.mockRejectedValueOnce(new Error("response lost"));
  await expect(executor.start(task.id, input)).rejects.toThrow("response lost");
  const observed = await store.inspect(task.id);
  expect(observed.participants[0].attempt.delivery).toBe("unknown");
  expect(observed.participants[1].attempt.delivery).toBe("none");
  await expect(executor.start(task.id, input)).rejects.toThrow();
  expect(create).toHaveBeenCalledTimes(1);
});
it("records idle separately from completion and retains the last observation on disconnect", async () => {
  const { task, store, executor, input, sessions } = await setup();
  await executor.start(task.id, input);
  sessions[0].status = "idle"; await executor.reconcile();
  const idle = (await store.inspect(task.id)).participants[0].attempt;
  expect(idle.execution).toBe("idle"); expect(idle.submittedResultId).toBe(null);
  sessions[0].connected = false; await executor.reconcile();
  const lost = (await store.inspect(task.id)).participants[0].attempt;
  expect(lost.execution).toBe("lost"); expect(lost.observedAt).toBe(idle.observedAt);
});
