// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import { TaskStore } from "./host/task-store";
import { TaskMcpServer, TASK_MCP_TOOLS } from "./mcw-task-mcp";
import type { TaskIdentity } from "../shared/host-types";
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "task-mcp-")); directories.push(directory);
  const store = new TaskStore({ directory, hostId: "pc-a" });
  const task = await store.createTask({ title: "Build", brief: "Leave for review", lead: { provider: "codex", profileId: "selected", hostId: "pc-a" }, workers: [{ provider: "claude", profileId: "worker" }] });
  const identities = task.participants.map(member => ({ taskId: task.id, participantId: member.id, attemptId: member.attempt.id, generation: member.attempt.generation, hostId: member.hostId, role: member.role } satisfies TaskIdentity));
  return { store, task, lead: new TaskMcpServer(store, identities[0]), worker: new TaskMcpServer(store, identities[1]), identities };
}
const call = (server: TaskMcpServer, name: string, args: unknown) => server.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

it("exposes semantic task tools and executes durable messages without shell or session operations", async () => {
  const { lead, store, task } = await fixture();
  const listed = JSON.stringify(await lead.handle({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
  expect(listed).toContain("task_submit"); expect(listed).not.toMatch(/terminal_exec|session_send|shell_exec/);
  expect(await call(lead, "task_message", { to: null, text: "Ready for review" })).toMatchObject({ result: { isError: false } });
  expect((await store.inspect(task.id)).events).toMatchObject([{ kind: "message", text: "Ready for review" }]);
});

it("describes task reads and bounded store mutations accurately for native client approvals",()=>{
  const tools=TASK_MCP_TOOLS;
  expect(tools.filter(t=>t.annotations?.readOnlyHint).map(t=>t.name)).toEqual(["task_inspect","task_wait"]);
  expect(tools.every(t=>t.annotations?.openWorldHint===false&&t.annotations?.destructiveHint===false)).toBe(true);
  expect(tools.filter(t=>t.annotations?.idempotentHint).map(t=>t.name)).toEqual(["task_inspect","task_wait"]);
});

it("rejects identity injection, invalid providers, extra fields, forged roles and worker assignment", async () => {
  const { lead, worker, store, task } = await fixture();
  for (const args of [{ provider: "shell", profileId: "p" }, { provider: "codex", profileId: "p", command: "rm" }]) expect(await call(lead, "task_assign", args)).toMatchObject({ result: { isError: true } });
  expect(await call(worker, "task_assign", { provider: "codex", profileId: "p" })).toMatchObject({ result: { isError: true } });
  expect(await call(lead, "task_assign", { provider: "codex", profileId: "unselected" })).toMatchObject({ result: { isError: true } });
  expect(await call(worker, "task_cancel", { role: "lead" })).toMatchObject({ result: { isError: true } });
  expect(await call(worker, "task_message", { to: null, text: "hi", taskId: "foreign" })).toMatchObject({ result: { isError: true } });
  expect(await call(lead, "task_cancel", null)).toMatchObject({ result: { isError: true } });
  expect(await call(worker, "task_message", { text: "hi", kind: null })).toMatchObject({ result: { isError: true } });
  expect((await store.inspect(task.id)).cancellation).toBe("none");
  expect((await store.inspect(task.id)).participants).toHaveLength(2);
});

it("wakes wait for questions and submitted results and keeps evidence unintegrated", async () => {
  const { lead, worker, store, task } = await fixture();
  const waiting = call(lead, "task_wait", { cursor: 0, timeoutMs: 15000 });
  await call(worker, "task_message", { kind: "question", text: "Which API?" });
  expect(JSON.stringify(await waiting)).toContain("Which API?");
  expect(await call(worker, "task_submit", { summary: "Implemented", changes: ["a.ts"], verification: ["test passed"], artifacts: [], issues: ["review pending"] })).toMatchObject({ result: { isError: false } });
  expect((await store.inspect(task.id)).results[0]).toMatchObject({ integration: "unintegrated", review: "pending" });
}, 30000);

it("supports MCP initialization, rejects malformed JSON-RPC, and never mutates on tool notifications", async () => {
  const { lead, store, task } = await fixture();
  expect(await lead.handle({ jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } })).toMatchObject({ id: "init", result: { capabilities: { tools: {} } } });
  expect(await lead.handle({ jsonrpc: "2.0", id: 1, method: "missing" })).toMatchObject({ error: { code: -32601 } });
  expect(await lead.handle({ id: 1, method: "tools/list" })).toMatchObject({ error: { code: -32600 } });
  expect(await lead.handle({ jsonrpc: "2.0", method: "tools/call", params: { name: "task_cancel", arguments: {} } })).toBeNull();
  expect((await store.inspect(task.id)).cancellation).toBe("none");
});

it("accepts MCP request metadata without treating it as task authority or tool arguments",async()=>{
  const {worker,store,task,identities}=await fixture();
  const meta={progressToken:17,"client/example":{context:"test"},role:"lead",taskId:"other"};
  expect(await worker.handle({jsonrpc:"2.0",id:1,method:"tools/list",params:{_meta:meta}})).toMatchObject({result:{tools:expect.any(Array)}});
  expect(await worker.handle({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"task_inspect",arguments:{},_meta:meta}})).toMatchObject({result:{isError:false}});
  expect(await worker.handle({jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"task_message",arguments:{text:"READY"},_meta:meta}})).toMatchObject({result:{isError:false}});
  expect((await store.inspect(task.id)).events[0].from).toBe(identities[1].participantId);
  expect(await worker.handle({jsonrpc:"2.0",id:4,method:"tools/call",params:{name:"task_cancel",arguments:{},_meta:meta}})).toMatchObject({result:{isError:true}});
  expect((await store.inspect(task.id)).cancellation).toBe("none");
  expect(await worker.handle({jsonrpc:"2.0",id:5,method:"tools/call",params:{name:"task_inspect",arguments:{},_meta:"invalid"}})).toMatchObject({error:{code:-32602}});
});
