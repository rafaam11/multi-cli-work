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
