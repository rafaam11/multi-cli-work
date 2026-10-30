// @vitest-environment node
import { mkdtemp, readFile, rm, stat,writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { request as httpRequest, Server } from "node:http";
import { WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import { HostGateway, writePrivateJson, type HostTerminalService } from "./gateway";
import { HostClient } from "./host-client";
import { TaskStore } from "./task-store";
import { ensureHostProcess, readHostDescriptor } from "./host-process";
import {remoteSessionId} from "../v2/observed-terminals";
import {HostWorkerGateway} from "../v2/worker-gateway";
import {WorkerReplicas} from "./worker-replicas";

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
async function setup(extra: Partial<import("./gateway").HostGatewayOptions> = {},hostId="pc-a") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcw-gateway-")); directories.push(directory);
  const store = new TaskStore({ directory, hostId }); const terminals = terminalService();
  const gateway = new HostGateway({ directory, store, terminals, maxBodyBytes: 1024, ...extra }); gateways.push(gateway);
  const descriptor = await gateway.start(); const client = new HostClient(descriptor);
  const fetchRoute = (route: string, init: RequestInit = {}) => fetch(`${descriptor.url}${route}`, { ...init, headers: { authorization: `Bearer ${descriptor.token}`, ...init.headers } });
  return { directory, store, terminals, gateway, descriptor, client, fetchRoute };
}
const taskInput = { title: "Review", brief: "Preserve execution across viewer disconnect", lead: { provider: "codex" as const, profileId: "default", hostId: "pc-a" }, workers: [{ provider: "claude" as const, profileId: "review" }] };
it("routes a remote view to the registered PC and leaves its process alive when the viewer closes",async()=>{
  const remote=await setup();remote.terminals.sessions.set("same",{id:"same"});
  const observation:import("../../shared/host-connection-types").RemoteHostObservation={hostId:"remote",name:"Lab",enabled:true,connected:true,observedAt:12,error:null,tasks:[],terminals:[{id:"same",kind:"codex",cwd:"/repo",projectId:null,status:"idle",connected:true,observedAt:12,tabId:"tab",paneId:"pane",generation:"g",createdAt:"2026-10-30T00:00:00Z"}]};
  const hosts={registrations:()=>[],snapshot:()=>[observation],configure:vi.fn(),remove:vi.fn(),onChange:()=>()=>{},client:vi.fn(()=>{if(!observation.connected)throw new Error("offline");return remote.client;})};
  const local=await setup({hosts});local.terminals.sessions.set("same",{id:"same"});
  const viewId=remoteSessionId("remote","same"),view=await viewer(local.descriptor.url,local.descriptor.token);
  view.send({type:"subscribe",sessionId:viewId});const snapshot=await view.next("snapshot");
  expect(snapshot).toMatchObject({sessionId:viewId,snapshot:{surface:"same"},viewerId:view.viewerId});
  view.send({type:"input",data:{TextCommit:"blocked"}});await view.next("error");expect(remote.terminals.input).not.toHaveBeenCalled();
  view.send({type:"takeOwnership"});expect(await view.next("ownership")).toMatchObject({owner:true,ownerId:view.viewerId});
  view.send({type:"input",data:{TextCommit:"one command"}});
  await vi.waitFor(()=>expect(remote.terminals.input).toHaveBeenCalledOnce());expect(local.terminals.input).not.toHaveBeenCalled();
  view.socket.close();await vi.waitFor(()=>expect(remote.terminals.releaseOwnership).toHaveBeenCalled());
  expect(remote.terminals.stop).not.toHaveBeenCalled();
  observation.connected=false;await expect(local.client.stopTerminal(viewId)).rejects.toThrow();expect(remote.terminals.stop).not.toHaveBeenCalled();
  observation.connected=true;await local.client.stopTerminal(viewId);expect(remote.terminals.stop).toHaveBeenCalledWith("same");expect(local.terminals.stop).not.toHaveBeenCalled();
});
it("routes remote task reads and exact user actions to the owning host without local mutation or replay",async()=>{
  const remote=await setup({},"pc-b");
  const task=await remote.store.createTask({...taskInput,lead:{...taskInput.lead,hostId:"pc-b"}});
  const lead=await remote.store.bind({taskId:task.id,participantId:task.participants[0].id,attemptId:task.participants[0].attempt.id,generation:1});
  const question=await remote.store.ask(lead,"question","Which target?");
  const result=await remote.store.submitResult(lead,{summary:"Prepared",changes:[],verification:["checked"],artifacts:[],issues:[]});
  const observation={hostId:"pc-b",name:"Remote",enabled:true,connected:true,observedAt:12,error:null,tasks:[await remote.store.inspect(task.id)],terminals:[]};
  const hosts={registrations:()=>[],snapshot:()=>[observation],configure:vi.fn(),remove:vi.fn(),onChange:()=>()=>{},client:vi.fn(()=>remote.client)};
  const local=await setup({hosts});
  const prefix=`/hosts/pc-b/tasks/${task.id}`;
  const localTask=await local.store.createTask(taskInput);
  const capability=await local.gateway.issueTaskToken({taskId:localTask.id,participantId:localTask.participants[0].id,attemptId:localTask.participants[0].attempt.id,generation:1});
  expect((await fetch(local.descriptor.url+"/hosts/pc-b/tasks",{headers:{authorization:`Bearer ${capability}`}})).status).toBe(403);
  expect(await local.client.request("/hosts/pc-b/tasks")).toHaveLength(1);
  expect(await local.client.request(prefix)).toMatchObject({id:task.id,ownerHostId:"pc-b"});
  expect((await remote.store.inspect(task.id)).questions[0].acknowledged).toBe(false);
  await local.client.request(`${prefix}/acknowledge`,"POST",{eventId:question.id});
  await local.client.request(`${prefix}/answer`,"POST",{eventId:question.id,text:"Keep unintegrated"});
  await local.client.request(`${prefix}/acknowledge-result`,"POST",{resultId:result.id});
  const updated=await remote.store.inspect(task.id);
  expect(updated.questions[0]).toMatchObject({acknowledged:true,answer:"Keep unintegrated"});
  expect(updated.results[0]).toMatchObject({integration:"unintegrated",review:"acknowledged"});
  expect(await local.store.list()).toEqual([localTask]);
  await expect(local.client.request(`${prefix}/start`,"POST",{})).rejects.toThrow();
  await expect(local.client.request("/hosts/unregistered/tasks")).rejects.toThrow();
  observation.connected=false;const before=(await remote.store.inspect(task.id)).events.length;
  await expect(local.client.request(`${prefix}/message`,"POST",{text:"must not queue"})).rejects.toThrow();
  observation.connected=true;
  expect((await remote.store.inspect(task.id)).events).toHaveLength(before);
  await local.client.request(`${prefix}/message`,"POST",{text:"once"});
  expect((await remote.store.inspect(task.id)).events.filter(event=>event.text==="once")).toHaveLength(1);
  const forward=remote.client.request.bind(remote.client);
  const missingReply=vi.spyOn(remote.client,"request").mockImplementation(async <T,>(route:string,method?:string,input?:unknown,timeoutMs?:number)=>{
    const result=await forward<T>(route,method,input,timeoutMs);
    if(method==="POST"&&route.endsWith("/message"))throw new Error("reply lost after commit");return result;
  });
  await expect(local.client.request(`${prefix}/message`,"POST",{text:"ambiguous"})).rejects.toThrow(/전달되었을 수/);
  expect((await remote.store.inspect(task.id)).events.filter(event=>event.text==="ambiguous")).toHaveLength(1);
  missingReply.mockRestore();
  await local.client.request(`${prefix}/cancel`,"POST",{});
  expect((await remote.store.inspect(task.id)).cancellation).toBe("requested");
  expect(remote.terminals.stop).not.toHaveBeenCalled();
});
it("uses the remote owner's catalog for explicit creation and checked startup, without forwarding local executables",async()=>{
  const profile={id:"selected",name:"Remote",agentId:"codex" as const,model:null,effort:null};
  const repository={id:"repo",name:"Remote repo",path:"/remote/repo",projectId:null,projectName:null};
  const catalog={version:1 as const,hostId:"pc-b",platform:"linux" as const,launchProfiles:[profile],defaultLaunchProfiles:{codex:profile.id},availableProviders:["codex" as const],repositories:[repository]};
  const head="a".repeat(40),resolved={repositoryPath:repository.path,expectedHead:head,profiles:[{participantId:"resolved",profile,executable:"/remote/codex"}]};
  const executionCatalog={read:vi.fn(async()=>catalog),inspectRepository:vi.fn(async()=>({repository,expectedHead:head})),validateCreate:vi.fn(async(value:unknown)=>value as import("../../shared/host-types").TaskCreateInput),prepare:vi.fn(async()=>resolved)};
  const startTask=vi.fn(async()=>({terminals:[{id:"remote-pane"}]}));
  const remote=await setup({executionCatalog,startTask},"pc-b");
  const observation={hostId:"pc-b",name:"Remote",enabled:true,connected:true,observedAt:12,error:null,tasks:[],terminals:[]};
  const hosts={registrations:()=>[],snapshot:()=>[observation],configure:vi.fn(),remove:vi.fn(),onChange:()=>()=>{},client:vi.fn(()=>remote.client)};
  const local=await setup({hosts});
  expect(await local.client.request("/hosts/pc-b/execution-catalog")).toEqual(catalog);
  expect(await local.client.request("/hosts/pc-b/execution-catalog/repositories/repo")).toEqual({repository,expectedHead:head});
  const input={title:"Remote selected",brief:"Use checked checkout",lead:{hostId:"pc-b",provider:"codex" as const,profileId:profile.id},workers:[]};
  const created=await local.client.request<import("../../shared/host-types").Task>("/hosts/pc-b/tasks","POST",input);
  expect(created.ownerHostId).toBe("pc-b");expect(executionCatalog.validateCreate).toHaveBeenCalledExactlyOnceWith(input);
  const selected={repositoryId:repository.id,expectedHead:head};
  expect(await local.client.request(`/hosts/pc-b/tasks/${created.id}/start`,"POST",selected)).toEqual({terminals:[{id:"remote-pane"}]});
  expect(executionCatalog.prepare).toHaveBeenCalledExactlyOnceWith(created,selected);
  expect(startTask).toHaveBeenCalledExactlyOnceWith(created.id,resolved);
  expect(await local.store.list()).toEqual([]);expect(local.terminals.create).not.toHaveBeenCalled();
  observation.connected=false;
  await expect(local.client.request(`/hosts/pc-b/tasks/${created.id}/start`,"POST",selected)).rejects.toThrow();
  expect(startTask).toHaveBeenCalledTimes(1);
  observation.connected=true;await local.client.drain();
  await expect(local.client.request("/hosts/pc-b/tasks","POST",input)).rejects.toThrow();
  await expect(local.client.request(`/hosts/pc-b/tasks/${created.id}/start`,"POST",selected)).rejects.toThrow();
  expect(startTask).toHaveBeenCalledTimes(1);
});
it("scopes worker MCP capabilities to durable replicas and exposes transfer/admission only to the owner",async()=>{
  const owner=await setup(),task=await owner.store.createTask({...taskInput,workers:[{hostId:"pc-b",provider:"codex",profileId:"remote"}]});
  const member=task.participants[1],identity=await owner.store.bind({taskId:task.id,participantId:member.id,attemptId:member.attempt.id,generation:1});
  const directory=await mkdtemp(path.join(os.tmpdir(),"mcw-worker-gateway-"));directories.push(directory);
  const replicas=new WorkerReplicas({directory,hostId:"pc-b"}),workers={replicas,prepare:vi.fn(replicas.register.bind(replicas)),admit:vi.fn(async()=>({replicaId:"unused",terminal:null,attempt:member.attempt}))};
  const remote=await setup({workers,maxBodyBytes:512*1024},"pc-b");
  const selection={repositoryId:"repo",expectedPath:directory,expectedHead:"a".repeat(40)};
  const registered=await remote.client.request<{id:string}>("/workers/prepare","POST",{task,identity,selection});
  const token=await remote.gateway.issueWorkerTaskToken(identity);
  const connectionFile=path.join(remote.directory,"task-mcp",`${identity.attemptId}.connection.json`);
  await writePrivateJson(connectionFile,{endpoint:remote.descriptor.url+"/mcp",token});
  const rpc=async(name:string,args:unknown={})=>(await fetch(remote.descriptor.url+"/mcp",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name,arguments:args}})})).json();
  expect((await rpc("task_message",{text:"Saved offline"})).result.isError).toBe(false);
  const transfer=await remote.client.request<{pending:import("../../shared/remote-task-types").RemoteTaskOperation[]}>(`/workers/${registered.id}`);
  expect(transfer.pending).toHaveLength(1);expect((await owner.store.inspect(task.id)).events).toHaveLength(0);
  expect((await fetch(remote.descriptor.url+`/workers/${registered.id}`,{headers:{authorization:`Bearer ${token}`}})).status).toBe(403);
  expect((await fetch(remote.descriptor.url+"/tasks",{headers:{authorization:`Bearer ${token}`}})).status).toBe(403);
  for(const operation of transfer.pending)await owner.store.ingestRemoteOperation(operation,"pc-b");
  await remote.client.request(`/workers/${registered.id}/sync`,"POST",{task:await owner.store.inspect(task.id),acknowledged:transfer.pending.map(operation=>operation.id)});
  expect(await replicas.pending(registered.id)).toEqual([]);
  await remote.client.drain();await expect(remote.client.request("/workers/prepare","POST",{task,identity,selection})).rejects.toThrow();
  await expect(remote.client.request(`/workers/${registered.id}/admit`,"POST",{task,commandId:"new"})).rejects.toThrow();expect(workers.admit).not.toHaveBeenCalled();
  await replicas.observeExecution(identity,"running");expect(await remote.gateway.canShutdown()).toBe(false);
  await remote.gateway.close();
  const reopened=new HostGateway({...remote.gateway.options,workers:{...workers,replicas:new WorkerReplicas(replicas.options)}});gateways.push(reopened);
  const connection=await reopened.start();
  expect(JSON.parse(await readFile(connectionFile,"utf8"))).toEqual({endpoint:connection.url+"/mcp",token});
  const response=await fetch(connection.url+"/mcp",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"task_inspect",arguments:{}}})});
  expect((await response.json()).result.isError).toBe(false);
});
it("lists and inspects worker PCs reachable from the selected owner, without exposing host credentials",async()=>{
  const remote=await setup({},"worker-pc");
  const catalog={version:1 as const,hostId:"worker-pc",platform:"linux" as const,launchProfiles:[],defaultLaunchProfiles:{},availableProviders:[],repositories:[{id:"worker-repo",name:"Repo",path:"/srv/repo",projectId:null,projectName:null}]};
  remote.gateway.options.executionCatalog={read:async()=>catalog,inspectRepository:async()=>({repository:catalog.repositories[0],expectedHead:"a".repeat(40)}),validateCreate:async()=>{throw new Error();},prepare:async()=>{throw new Error();}};
  const observation={hostId:"worker-pc",name:"Worker PC",enabled:true,connected:true,observedAt:1,error:null,tasks:[],terminals:[]};
  const hosts={snapshot:()=>[observation],registrations:()=>[],configure:vi.fn(),remove:vi.fn(),onChange:()=>()=>{},client:()=>remote.client};
  const owner=await setup({hosts},"owner-pc"),ownerObservation={...observation,hostId:"owner-pc",name:"Owner"};
  const viewer=await setup({hosts:{...hosts,snapshot:()=>[ownerObservation],client:()=>owner.client}},"viewer");
  expect(await viewer.client.request("/hosts/owner-pc/worker-hosts")).toEqual([{hostId:"worker-pc",name:"Worker PC",connected:true}]);
  expect(await viewer.client.request("/hosts/owner-pc/worker-hosts/worker-pc/execution-catalog")).toEqual(catalog);
  expect(await viewer.client.request("/hosts/owner-pc/worker-hosts/worker-pc/execution-catalog/repositories/worker-repo")).toEqual({repository:catalog.repositories[0],expectedHead:"a".repeat(40)});
  observation.connected=false;await expect(viewer.client.request("/hosts/owner-pc/worker-hosts/worker-pc/execution-catalog")).rejects.toThrow();
  expect(await owner.client.request("/worker-hosts")).toEqual([{hostId:"worker-pc",name:"Worker PC",connected:false}]);
});
it("exposes SSH registrations and non-secret local connection info only to the owner and freezes edits while draining",async()=>{
  const hosts={registrations:vi.fn(()=>[]),snapshot:vi.fn(()=>[]),configure:vi.fn(async()=>{}),remove:vi.fn(async()=>{}),onChange:vi.fn(()=>()=>{}),client:vi.fn()};
  const info={hostId:"pc-a",platform:"linux" as const,nodeExecutable:"/opt/node",hostEntrypoint:"/opt/mcw-host.js",dataRoot:"/home/me/mcw"};
  const {client,descriptor}=await setup({hosts,connectionInfo:()=>info});
  expect(await client.request("/connection")).toEqual(info);
  expect(await client.request("/hosts")).toEqual({registrations:[],observations:[]});
  expect((await fetch(descriptor.url+"/hosts")).status).toBe(401);
  const registration={name:"remote",enabled:true,ssh:{}};await client.request("/hosts","POST",registration);expect(hosts.configure).toHaveBeenCalledExactlyOnceWith(registration);
  await client.drain();await expect(client.request("/hosts","POST",registration)).rejects.toThrow(/draining/);
  await expect(client.request("/hosts/remote","DELETE")).rejects.toThrow(/draining/);expect(hosts.remove).not.toHaveBeenCalled();
});
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

it("reports related remote work in a read-only owner recovery plan",async()=>{
  const {client,store,fetchRoute,gateway}=await setup();
  const task=await store.createTask({...taskInput,workers:[{provider:"codex",profileId:"remote",hostId:"pc-b"}]});
  const worker=task.participants[1],ref={taskId:task.id,participantId:worker.id,attemptId:worker.attempt.id,generation:worker.attempt.generation};
  await store.beginDelivery(await store.bind(ref),"pending-remote");
  const response=await fetchRoute("/recovery-plan");expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({schemaVersion:1,hostId:"pc-a",accepting:true,canShutdown:false,related:[{hostId:"pc-b",taskIds:[task.id]}]});
  expect((await client.health()).accepting).toBe(true);
  const lead=task.participants[0],token=await gateway.issueTaskToken({taskId:task.id,participantId:lead.id,attemptId:lead.attempt.id,generation:lead.attempt.generation});
  expect((await fetchRoute("/recovery-plan",{headers:{authorization:`Bearer ${token}`}})).status).toBe(403);
});

it("keeps terminal observation available after new work is drained",async()=>{
  const {gateway,descriptor,terminals}=await setup();terminals.sessions.set("s",{id:"s"});gateway.drain();
  const connected=await viewer(descriptor.url,descriptor.token);
  connected.send({type:"subscribe",sessionId:"s"});expect(await connected.next("snapshot")).toMatchObject({type:"snapshot"});
});

it("enforces durable scoped recovery holds while leaving other tasks and messages available",async()=>{
  const startTask=vi.fn(async()=>({started:true}));const {store,client,fetchRoute,gateway,directory,terminals}=await setup({startTask});
  const first=await store.createTask(taskInput),second=await store.createTask(taskInput);
  const hold={id:"recovery-fixture",requesterHostId:"pc-a",taskIds:[first.id]};
  const response=await fetchRoute("/recovery/holds",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(hold)});
  expect(response.status).toBe(201);
  await expect(client.startTask(first.id,{})).rejects.toThrow(/recovery|held/i);
  await expect(client.startTask(second.id,{})).resolves.toMatchObject({started:true});
  terminals.sessions.set("unrelated",{id:"unrelated",status:"working",connected:true,delivery:"delivered"});
  expect(await client.request(`/recovery/holds/${hold.id}/readiness`)).toMatchObject({hostId:"pc-a",ready:true,holdActive:true});
  await client.request(`/tasks/${first.id}/message`,"POST",{text:"preserve this message"});
  expect((await store.inspect(first.id)).events.at(-1)?.text).toBe("preserve this message");
  await gateway.close();const replacement=new HostGateway({directory,store,terminals,startTask});gateways.push(replacement);const next=new HostClient(await replacement.start());
  await expect(next.startTask(first.id,{})).rejects.toThrow(/recovery|held/i);
  await next.request(`/recovery/holds/${hold.id}/release`,"POST",{requesterHostId:"pc-a"});
  expect(await next.request(`/recovery/holds/${hold.id}/readiness`)).toMatchObject({ready:false,holdActive:false});
  await expect(next.startTask(first.id,{})).resolves.toMatchObject({started:true});
});
it("does not use an older fallback task snapshot as proof that recovery work is settled",async()=>{
  const {store,gateway,client}=await setup();
  await store.createTask(taskInput);await store.createTask(taskInput);
  await writeFile(store.filePath,'{corrupt');
  expect(await store.list()).toHaveLength(1); // The history remains viewable.
  expect(await gateway.canShutdown()).toBe(false);
  await expect(client.request('/recovery-plan')).rejects.toThrow();
});
it("keeps independent host-wide holds separate and refuses a foreign host-wide request",async()=>{
  const {client,gateway,fetchRoute}=await setup();
  const hold=(id:string)=>({id,requesterHostId:'pc-a',taskIds:null});
  expect((await fetchRoute('/recovery/holds',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...hold('foreign'),requesterHostId:'pc-b'})})).status).toBe(403);
  await client.request('/recovery/holds','POST',hold('one'));await client.request('/recovery/holds','POST',hold('two'));
  await client.request('/recovery/holds/one/release','POST',{requesterHostId:'pc-a'});expect((await client.health()).accepting).toBe(false);
  gateway.drain();await client.request('/recovery/holds/two/release','POST',{requesterHostId:'pc-a'});expect((await client.health()).accepting).toBe(false);
  expect(await client.request('/recovery/holds')).toHaveLength(2);
});
it("rechecks terminal observation before recovery readiness and refuses stale cached exits",async()=>{
  const {gateway,terminals,client}=await setup();
  terminals.sessions.set("s",{status:"exited",connected:true,delivery:"delivered"});
  const refresh=vi.fn().mockRejectedValueOnce(new Error("Herdr unavailable")).mockResolvedValue(undefined);
  gateway.options.terminals.refreshObservation=refresh;
  expect(await gateway.canShutdown()).toBe(false);
  expect(await client.request("/recovery-readiness")).toMatchObject({hostId:"pc-a",accepting:true,canShutdown:true});
  expect(refresh).toHaveBeenCalledTimes(2);expect((await client.health()).accepting).toBe(true);
});

it("routes GUI checkout leases through owner-authenticated host admission and preserves lease identity",async()=>{
 const acquire=vi.fn(async(_cwd:string,_id:string,_pid:number)=>{}),release=vi.fn(async(_id:string)=>{});
 const terminals={...terminalService(),acquireCheckoutRemoval:acquire,releaseCheckoutRemoval:release};
 const {client,store,gateway,descriptor}=await setup({terminals});
 const worker=new HostWorkerGateway(client),cwd=path.resolve("checkout");
 const unlock=await worker.holdCheckoutRemoval(cwd,"persisted-operation");
 expect(acquire).toHaveBeenCalledWith(cwd,expect.any(String),process.pid);
 expect(release).not.toHaveBeenCalled();await unlock();expect(release).toHaveBeenCalledWith(acquire.mock.calls[0][1]);
 const task=await store.createTask(taskInput),lead=task.participants[0];
 const token=await gateway.issueTaskToken({taskId:task.id,participantId:lead.id,attemptId:lead.attempt.id,generation:1});
 const unauthorized=new HostClient({...descriptor,token});
 await expect(unauthorized.request("/checkout-removal/acquire","POST",{cwd,id:"other",pid:process.pid})).rejects.toThrow(/Owner/);
 expect(acquire).toHaveBeenCalledOnce();
});

it("refuses host shutdown while a checkout Git deletion is running or unknown",async()=>{
 const busy=vi.fn(async()=>true),{gateway}=await setup({terminals:{...terminalService(),checkoutRemovalBusy:busy}});
 expect(await gateway.canShutdown()).toBe(false);busy.mockResolvedValue(false);expect(await gateway.canShutdown()).toBe(true);
});
