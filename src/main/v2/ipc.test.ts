// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { registerV2Ipc, type V2IpcOptions } from "./ipc";

afterEach(()=>vi.useRealTimers());
function setup() {
  const handlers=new Map<string,Function>();
  const client={tasks:vi.fn(),inspectTask:vi.fn(async()=>({id:"task",participants:[{id:"lead",profileId:"selected",provider:"codex"}],projectId:"project"})),startTask:vi.fn(async()=>({terminals:[]})),request:vi.fn(),terminalSocket:vi.fn()};
  const reconcile=vi.fn(async()=>{}),profile={id:"selected",name:"Chosen",agentId:"codex",model:"chosen-model",effort:"high"};
  const options={ipc:{handle:(name:string,fn:Function)=>handlers.set(name,fn),removeHandler:(name:string)=>handlers.delete(name)},authorize:(event:unknown)=>event==="trusted",send:vi.fn(),client,hostId:"host",backupDirectory:"backup",configuration:async()=>({launchProfiles:[profile],defaultLaunchProfiles:{}}),executable:async()=>"C:/trusted/codex.exe",reconcile} as unknown as V2IpcOptions;
  const dispose=registerV2Ipc(options);
  return {client,reconcile,profile,dispose,options,call:(name:string,...args:unknown[])=>handlers.get(`v2:${name}`)!("trusted",...args),handlers};
}
it("refuses every untrusted renderer invocation before touching the host",()=>{
  const {handlers,client,dispose}=setup();
  for(const handler of handlers.values())expect(()=>handler("untrusted")).toThrow("Untrusted");
  expect(client.tasks).not.toHaveBeenCalled();dispose();expect(handlers.size).toBe(0);
});
it("resolves task profile and executable in the main process and rejects renderer overrides",async()=>{
  const {call,client,profile,reconcile,dispose}=setup();
  const input={repositoryPath:"C:/repo",expectedHead:"a".repeat(40)};
  await expect(call("task-start","task",{...input,profiles:[]})).rejects.toThrow();
  expect(client.startTask).not.toHaveBeenCalled();
  await call("task-start","task",input);
  expect(client.startTask).toHaveBeenCalledWith("task",{...input,profiles:[{participantId:"lead",profile,executable:"C:/trusted/codex.exe"}],projectId:null});
  expect(reconcile).toHaveBeenCalledOnce();dispose();
});
it("binds task terminals to the verified repository instead of using the work-project ID",async()=>{
  const {call,client,options,dispose}=setup();
  options.repositoryProjectId=vi.fn(async()=>"repository-project");
  await call("task-start","task",{repositoryPath:"C:/repo",expectedHead:"a".repeat(40)});
  expect(client.startTask).toHaveBeenCalledWith("task",expect.objectContaining({projectId:"repository-project"}));
  expect(options.repositoryProjectId).toHaveBeenCalledWith("C:/repo");dispose();
});
it("restricts task owner actions and keeps approval separate from task execution",async()=>{
  const {call,client,dispose}=setup();
  expect(()=>call("task-action","task","start",{})).toThrow();
  await call("task-action","task","answer",{eventId:"q",text:"Keep pending"});
  expect(client.request).toHaveBeenCalledWith("/tasks/task/answer","POST",{eventId:"q",text:"Keep pending"});
  expect(client.startTask).not.toHaveBeenCalled();dispose();
});
it("forwards remote task operations with an explicit host scope and resolves only observed terminal IDs",async()=>{
  const {call,client,options,dispose}=setup();
  await call("tasks","remote");expect(client.tasks).toHaveBeenCalledWith("remote");
  await call("task-inspect","task","remote");expect(client.inspectTask).toHaveBeenCalledWith("task","remote");
  await call("task-action","task","answer",{eventId:"q",text:"review"},"remote");
  expect(client.request).toHaveBeenCalledWith("/hosts/remote/tasks/task/answer","POST",{eventId:"q",text:"review"});
  expect(()=>call("task-action","task","answer",{},"../other")).toThrow();
  options.state=()=>({connected:true,observedAt:1,tasks:[],terminals:[],hosts:[{hostId:"remote",name:"Lab",enabled:true,connected:true,observedAt:1,error:null,tasks:[],terminals:[{id:"attempt",kind:"codex",cwd:"/repo",projectId:null,status:"idle",connected:true,observedAt:1,tabId:"t",paneId:"p",generation:"g",createdAt:"now"}]}]});
  expect(call("terminal-view-id","attempt","remote")).toMatch(/^mcwr-[a-f0-9]{64}$/);
  expect(()=>call("terminal-view-id","missing","remote")).toThrow();
  expect(()=>call("terminal-view-id","attempt","unregistered")).toThrow();
  expect(client.startTask).not.toHaveBeenCalled();dispose();
});
it("passes only registered remote selection through IPC and never resolves a remote path on this PC",async()=>{
  const {call,client,options,dispose}=setup();
  options.executable=vi.fn();options.repositoryProjectId=vi.fn();
  await call("execution-catalog","remote");expect(client.request).toHaveBeenLastCalledWith("/hosts/remote/execution-catalog");
  await call("host-repository","repo","remote");expect(client.request).toHaveBeenLastCalledWith("/hosts/remote/execution-catalog/repositories/repo");
  const input={repositoryId:"repo",expectedHead:"a".repeat(40),expectedPath:"/remote/repo"};
  await call("task-start-registered","task",input,"remote");
  expect(client.request).toHaveBeenLastCalledWith("/hosts/remote/tasks/task/start","POST",input);
  await expect(call("task-start-registered","task",{...input,executable:"local.exe"},"remote")).rejects.toThrow();
  expect(options.executable).not.toHaveBeenCalled();expect(options.repositoryProjectId).not.toHaveBeenCalled();
  dispose();
});
it("scopes worker catalog reads through the owner and resolves only local participant executables",async()=>{
  const {call,client,options,dispose}=setup();
  await call("execution-hosts","owner");expect(client.request).toHaveBeenLastCalledWith("/hosts/owner/worker-hosts");
  await call("worker-catalog","worker","owner");expect(client.request).toHaveBeenLastCalledWith("/hosts/owner/worker-hosts/worker/execution-catalog");
  await call("worker-repository","repo","worker","owner");expect(client.request).toHaveBeenLastCalledWith("/hosts/owner/worker-hosts/worker/execution-catalog/repositories/repo");
  const task=await client.inspectTask();Object.assign(task.participants[0],{hostId:"host"});task.participants.push(Object.assign({...task.participants[0],id:"worker",profileId:"remote-only"},{hostId:"worker"}));client.inspectTask.mockResolvedValue(task);
  options.executable=vi.fn(async()=>"C:/trusted/codex.exe");
  const remoteWorkers=[{participantId:"worker",selection:{repositoryId:"repo",expectedPath:"/worker/repo",expectedHead:"a".repeat(40)}}];
  await call("task-start","task",{repositoryPath:"C:/repo",expectedHead:"a".repeat(40),remoteWorkers});
  expect(options.executable).toHaveBeenCalledTimes(1);expect(client.startTask).toHaveBeenCalledWith("task",expect.objectContaining({remoteWorkers,profiles:[expect.objectContaining({participantId:"lead"})]}));
  dispose();
});
it("reconnects a retained Canvas viewer without replaying input or taking control",async()=>{
  vi.useFakeTimers();
  const {client,call,options,dispose}=setup(),listeners:((event:unknown)=>void)[]=[],sockets:{send:ReturnType<typeof vi.fn>;close:ReturnType<typeof vi.fn>}[]=[];
  client.terminalSocket.mockImplementation((_id:string,listener:(event:unknown)=>void)=>{listeners.push(listener);const socket={send:vi.fn(),close:vi.fn()};sockets.push(socket);return socket;});
  await call("terminal-subscribe","session","viewer");
  listeners[0]({type:"authenticated",viewerId:"first"});
  listeners[0]({type:"snapshot",snapshot:{type:"surface"}});
  await call("terminal-command","session",{type:"input",data:{TextCommit:"once"}});
  listeners[0]({type:"disconnected"});
  expect(()=>call("terminal-command","session",{type:"input",data:{TextCommit:"lost"}})).toThrow(/연결/);
  await vi.advanceTimersByTimeAsync(1000);
  expect(sockets).toHaveLength(2);expect(sockets[1].send).not.toHaveBeenCalled();
  listeners[1]({type:"authenticated",viewerId:"second"});
  listeners[0]({type:"ownership",ownerId:"first"});
  expect(options.send).not.toHaveBeenLastCalledWith("v2:terminal-event","session",{type:"ownership",ownerId:"first"});
  dispose();await vi.advanceTimersByTimeAsync(3000);expect(sockets).toHaveLength(2);
});
