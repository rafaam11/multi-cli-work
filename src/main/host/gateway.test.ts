// @vitest-environment node
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { request as httpRequest, Server } from "node:http";
import { WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import { HostGateway, type HostTerminalService } from "./gateway";
import { HostClient } from "./host-client";
import { TaskStore } from "./task-store";
import { ensureHostProcess, readHostDescriptor } from "./host-process";

const directories: string[] = []; const gateways: HostGateway[] = []; const sockets: WebSocket[] = [];
afterEach(async () => { for (const socket of sockets.splice(0)) socket.terminate(); await Promise.all(gateways.splice(0).map(gateway => gateway.close())); await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
function terminalService() {
  const sessions = new Map<string, unknown>(); const frames = new EventEmitter();
  const service = {
    sessions, frames,
    list: vi.fn(async () => [...sessions.values()]),
    create: vi.fn(async (input: Record<string, unknown>) => { const session = { sessionId: input.sessionId }; sessions.set(input.sessionId as string, session); return session; }),
    stop: vi.fn(async (id: string) => { sessions.delete(id); }),
    snapshot: vi.fn(async (id: string) => { if (!sessions.has(id)) throw new Error("Unknown session"); return { surface: id }; }),
    subscribeFrames: vi.fn((id: string, callback: (frame: unknown) => void) => { frames.on(id, callback); return () => { frames.off(id, callback); }; }),
    input: vi.fn(async (_id: string, _viewer: string, _data: unknown) => undefined),
    resize: vi.fn(async (_id: string, _viewer: string, _cols: number, _rows: number, _width?: number, _height?: number) => undefined),
    scroll: vi.fn(async (_id: string, _viewer: string, _delta: number) => undefined),
    takeOwnership: vi.fn(async (_id: string, _viewer: string) => undefined), releaseOwnership: vi.fn(async (_id: string, _viewer: string) => undefined),
  } satisfies HostTerminalService & { sessions: Map<string, unknown>; frames: EventEmitter };
  return service;
}
async function setup(extra: Partial<import("./gateway").HostGatewayOptions> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcw-gateway-")); directories.push(directory);
  const store = new TaskStore({ directory, hostId: "pc-a" }); const terminals = terminalService();
  const gateway = new HostGateway({ directory, store, terminals, maxBodyBytes: 1024, ...extra }); gateways.push(gateway);
  const descriptor = await gateway.start(); const client = new HostClient(descriptor);
  const fetchRoute = (route: string, init: RequestInit = {}) => fetch(`${descriptor.url}${route}`, { ...init, headers: { authorization: `Bearer ${descriptor.token}`, ...init.headers } });
  return { directory, store, terminals, gateway, descriptor, client, fetchRoute };
}
const taskInput = { title: "Review", brief: "Preserve execution across viewer disconnect", lead: { provider: "codex" as const, profileId: "default", hostId: "pc-a" }, workers: [{ provider: "claude" as const, profileId: "review" }] };
it("rebinds an ephemeral Fetch-blocked port before publishing the host descriptor",async()=>{
  const original=Server.prototype.address;
  let calls=0;
  const address=vi.spyOn(Server.prototype,"address").mockImplementation(function(this:Server){const value=original.call(this);return ++calls===1&&value&&typeof value!=="string"?{...value,port:10080}:value;});
  try {const {client,descriptor}=await setup();expect(new URL(descriptor.url).port).not.toBe("10080");expect((await client.health()).hostId).toBe("pc-a");}
  finally{address.mockRestore();}
});
it("rejects an explicitly configured Fetch-blocked port before opening a listener",async()=>{
  await expect(setup({port:10080})).rejects.toThrow(/port/i);
});
it("changes endpoints only after verifying host and process identity, without dispatching work", async () => {
  const first = await setup(), next = await setup();
  await expect(first.client.reconnect(next.descriptor, "different-host")).rejects.toThrow("Host identity changed");
  expect(first.client.connection.url).toBe(first.descriptor.url);
  await expect(first.client.reconnect({ ...next.descriptor, instanceId: "stale" }, "pc-a")).rejects.toThrow("Host instance changed");
  expect(first.client.connection.url).toBe(first.descriptor.url);
  await first.client.reconnect(next.descriptor, "pc-a");
  expect((await first.client.health()).instanceId).toBe(next.descriptor.instanceId);
  expect(first.terminals.create).not.toHaveBeenCalled(); expect(next.terminals.create).not.toHaveBeenCalled();
});
it("admits explicit task starts only while accepting, and streams state without owning a terminal", async () => {
  const startTask = vi.fn(async (_id: string, _input: unknown) => ({ terminals: [] }));
  const { client, descriptor, fetchRoute } = await setup({ startTask });
  const task = await client.createTask(taskInput);
  const watcher = await viewer(descriptor.url, descriptor.token);
  watcher.send({ type: "watch" });
  expect((await watcher.next("state")).tasks).toHaveLength(1);
  await client.createTask({ ...taskInput, title: "second" });
  expect((await watcher.next("state")).tasks).toHaveLength(2);
  const input = { repositoryPath: "chosen", expectedHead: "verified", profiles: [] };
  expect((await fetchRoute(`/tasks/${task.id}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) })).status).toBe(200);
  expect(startTask).toHaveBeenCalledExactlyOnceWith(task.id, input);
  await client.drain();
  expect((await fetchRoute(`/tasks/${task.id}/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) })).status).toBe(409);
  expect(startTask).toHaveBeenCalledTimes(1);
});
function inbox(socket: WebSocket) {
  const messages: Record<string, unknown>[] = [];
  socket.on("message", data => { messages.push(JSON.parse(data.toString())); });
  return async (type: string) => { await vi.waitFor(() => { expect(messages.some(message => message.type === type)).toBe(true); }, { timeout: 2500, interval: 10 }); const index = messages.findIndex(message => message.type === type); return messages.splice(index, 1)[0]; };
}
async function viewer(url: string, token: string) {
  const socket = new WebSocket(`${url.replace("http:", "ws:")}/terminal`); sockets.push(socket); const next = inbox(socket);
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  socket.send(JSON.stringify({ type: "authenticate", token })); const welcome = await next("authenticated");
  const send = (input: unknown) => socket.send(JSON.stringify(input)); return { socket, next, send, viewerId: welcome.viewerId };
}

it("closes an unavailable initial surface so a viewer can reconnect instead of staying half subscribed",async()=>{
  const {terminals,descriptor}=await setup();
  await terminals.create({sessionId:"s"});
  terminals.snapshot.mockRejectedValueOnce(new Error("Bridge reconnecting"));
  const first=await viewer(descriptor.url,descriptor.token);
  const closed=new Promise<number>(resolve=>first.socket.once("close",resolve));
  first.send({type:"subscribe",sessionId:"s"});
  expect(await closed).toBe(1013);
  const next=await viewer(descriptor.url,descriptor.token);next.send({type:"subscribe",sessionId:"s"});
  expect((await next.next("snapshot")).sessionId).toBe("s");
});

it("authenticates every HTTP route and rejects origin, rebinding hosts and query credentials", async () => {
  const { descriptor, fetchRoute } = await setup();
  expect((await fetch(`${descriptor.url}/health`)).status).toBe(401);
  expect((await fetchRoute("/health", { headers: { origin: "https://attacker.invalid" } })).status).toBe(403);
  expect((await fetchRoute("/health?token=secret")).status).toBe(400);
  const status = await new Promise<number | undefined>(resolve => { const request = httpRequest(`${descriptor.url}/health`, { headers: { host: "attacker.invalid", authorization: `Bearer ${descriptor.token}` } }, response => { response.resume(); resolve(response.statusCode); }); request.end(); });
  expect(status).toBe(403);
  expect((await fetchRoute("/health")).status).toBe(200);
  expect((await fetchRoute("/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "x".repeat(2048) }) })).status).toBe(413);
});

it("persists private opaque credentials and prevents duplicate daemon instances", async () => {
  const { directory, descriptor, store, terminals, gateway } = await setup();
  expect((await readHostDescriptor(directory))?.instanceId).toBe(descriptor.instanceId);
  expect(descriptor.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  if (process.platform !== "win32") { expect((await stat(path.join(directory, "mcw-host-auth.json"))).mode & 0o777).toBe(0o600); expect((await stat(path.join(directory, "mcw-host.json"))).mode & 0o777).toBe(0o600); }
  const duplicate = new HostGateway({ directory, store, terminals }); gateways.push(duplicate);
  await expect(duplicate.start()).rejects.toThrow(/lock/i);
  await gateway.close();
  const reopened = new HostGateway({ directory, store, terminals }); gateways.push(reopened);
  const next = await reopened.start(); expect(next.token).toBe(descriptor.token); expect(next.instanceId).not.toBe(descriptor.instanceId);
  expect(JSON.parse(await readFile(path.join(directory, "mcw-host-auth.json"), "utf8")).owner).toBe(next.token);
});

it("binds MCP capabilities to trusted task participant identity and never accepts supplied scope", async () => {
  const { client, descriptor, fetchRoute } = await setup();
  const task = await client.createTask(taskInput); const worker = task.participants[1];
  const { token } = await client.issueTaskToken({ taskId: task.id, participantId: worker.id, attemptId: worker.attempt.id, generation: worker.attempt.generation });
  const rpc = (name: string, args: unknown = {}) => fetch(`${descriptor.url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }).then(response => response.json());
  expect((await rpc("task_inspect")).result.isError).toBe(false);
  expect((await rpc("task_assign", { provider: "codex", profileId: "p" })).result.isError).toBe(true);
  expect((await rpc("task_inspect", { taskId: "other", role: "lead" })).result.isError).toBe(true);
  expect((await fetch(`${descriptor.url}/tasks`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(403);
  expect((await fetchRoute("/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(403);
});

it("keeps terminal/task execution alive across GUI disconnect, enforces viewer ownership and drains safely", async () => {
  const { descriptor, client, store, terminals, fetchRoute } = await setup();
  const task = await client.createTask(taskInput); const lead = task.participants[0];
  await store.observeExecution(await store.bind({ taskId: task.id, participantId: lead.id, attemptId: lead.attempt.id, generation: lead.attempt.generation }), "running");
  await client.createTerminal({ sessionId: "session-a" });
  const owner = await viewer(descriptor.url, descriptor.token); owner.send({ type: "subscribe", sessionId: "session-a" });
  expect((await owner.next("snapshot")).ownerId).toBe(null);
  owner.send({ type: "takeOwnership", viewerId: "untrusted" }); expect((await owner.next("ownership")).ownerId).toBe(owner.viewerId);
  const observer = await viewer(descriptor.url, descriptor.token); observer.send({ type: "subscribe", sessionId: "session-a" });
  expect((await observer.next("snapshot")).ownerId).toBe(owner.viewerId);
  observer.send({ type: "snapshot" }); expect((await observer.next("snapshot")).snapshot).toEqual({ surface: "session-a" });
  observer.send({ type: "resize", cols: 200, rows: 50 }); expect((await observer.next("error")).error).toMatch(/own/);
  observer.send({ type: "takeOwnership" }); expect((await observer.next("error")).error).toMatch(/owner/);
  owner.send({ type: "resize", viewerId: "untrusted", cols: 90, rows: 24 });
  owner.send({ type: "input", data: { Paste: "echo test" } });
  await vi.waitFor(() => expect(terminals.input).toHaveBeenCalledWith("session-a", owner.viewerId, { Paste: "echo test" }));
  expect(terminals.resize).toHaveBeenCalledWith("session-a", owner.viewerId, 90, 24, 8, 16);
  terminals.frames.emit("session-a", { type: "patch", patch: { surface_revision: 3 } });
  expect((await observer.next("frame")).frame).toMatchObject({ type: "patch" });
  owner.socket.close(); await vi.waitFor(() => expect(terminals.releaseOwnership).toHaveBeenCalledWith("session-a", owner.viewerId));
  expect(terminals.stop).not.toHaveBeenCalled(); expect((await client.terminals()).length).toBe(1);
  expect((await client.inspectTask(task.id)).participants[0].attempt.execution).toBe("running");
  expect((await fetchRoute("/shutdown", { method: "POST" })).status).toBe(409);
  expect((await fetchRoute("/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(taskInput) })).status).toBe(409);
  expect((await client.health()).accepting).toBe(false);
});

it("rejects unauthenticated/oversized websocket messages and hostile websocket origins", async () => {
  const { descriptor } = await setup();
  const unauthenticated = new WebSocket(`${descriptor.url.replace("http:", "ws:")}/terminal`); sockets.push(unauthenticated);
  const closed = new Promise<number>(resolve => unauthenticated.once("close", code => resolve(code)));
  unauthenticated.once("open", () => unauthenticated.send(JSON.stringify({ type: "subscribe", sessionId: "s" })));
  expect(await closed).toBe(1008);
  const malicious = new WebSocket(`${descriptor.url.replace("http:", "ws:")}/terminal`, { origin: "https://attacker.invalid" }); sockets.push(malicious);
  expect(await new Promise<number>(resolve => { malicious.once("unexpected-response", (_request, response) => { response.resume(); malicious.terminate(); resolve(response.statusCode!); }); malicious.on("error", () => undefined); })).toBe(403);
  const connected = await viewer(descriptor.url, descriptor.token);
  const tooLarge = new Promise<number>(resolve => connected.socket.once("close", code => resolve(code)));
  connected.send({ type: "input", data: "x".repeat(70000) }); expect(await tooLarge).toBe(1009);
});

it("requires explicit remote binding and reuses an independently running host without launching anything", async () => {
  const { directory, descriptor, store, terminals } = await setup();
  await expect(new HostGateway({ directory, store, terminals, bindAddress: "0.0.0.0" }).start()).rejects.toThrow(/explicit/);
  const reused = await ensureHostProcess({ directory, hostId: "pc-a", entryPath: "DO-NOT-LAUNCH.js", terminalConfig: { binaryPath: "unused", binarySha256: "0".repeat(64), bridgePath: "unused" } });
  expect(reused.instanceId).toBe(descriptor.instanceId);
});

it("permits shutdown only for freshly confirmed exits and rejects pending terminal creation", async () => {
  const { gateway, terminals, fetchRoute } = await setup();
  terminals.sessions.set("s", { status: "exited", connected: false, delivery: "delivered" });
  expect(await gateway.canShutdown()).toBe(false);
  terminals.sessions.set("s", { status: "exited", connected: true, delivery: "unknown" });
  expect(await gateway.canShutdown()).toBe(false);
  terminals.sessions.set("s", { status: "exited", connected: true, delivery: "delivered" });
  expect(await gateway.canShutdown()).toBe(true);
  let resolveCreate!: () => void;
  terminals.create.mockImplementationOnce(async () => { await new Promise<void>(resolve => { resolveCreate = resolve; }); return { sessionId: "pending" }; });
  const creation = fetchRoute("/terminals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "pending" }) });
  await vi.waitFor(() => expect(resolveCreate).toBeTypeOf("function"));
  expect(await gateway.canShutdown()).toBe(false);
  expect((await fetchRoute("/shutdown", { method: "POST" })).status).toBe(409);
  resolveCreate(); expect((await creation).status).toBe(201);
});
