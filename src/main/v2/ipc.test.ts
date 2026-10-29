// @vitest-environment node
import { expect, it, vi } from "vitest";
import { registerV2Ipc, type V2IpcOptions } from "./ipc";

function setup() {
  const handlers=new Map<string,Function>();
  const client={tasks:vi.fn(),inspectTask:vi.fn(async()=>({id:"task",participants:[{id:"lead",profileId:"selected",provider:"codex"}],projectId:"project"})),startTask:vi.fn(async()=>({terminals:[]})),request:vi.fn(),terminalSocket:vi.fn()};
  const reconcile=vi.fn(async()=>{}),profile={id:"selected",name:"Chosen",agentId:"codex",model:"chosen-model",effort:"high"};
  const options={ipc:{handle:(name:string,fn:Function)=>handlers.set(name,fn),removeHandler:(name:string)=>handlers.delete(name)},authorize:(event:unknown)=>event==="trusted",send:vi.fn(),client,hostId:"host",backupDirectory:"backup",configuration:async()=>({launchProfiles:[profile],defaultLaunchProfiles:{}}),executable:async()=>"C:/trusted/codex.exe",reconcile} as unknown as V2IpcOptions;
  const dispose=registerV2Ipc(options);
  return {client,reconcile,profile,dispose,call:(name:string,...args:unknown[])=>handlers.get(`v2:${name}`)!("trusted",...args),handlers};
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
  expect(client.startTask).toHaveBeenCalledWith("task",{...input,profiles:[{participantId:"lead",profile,executable:"C:/trusted/codex.exe"}],projectId:"project"});
  expect(reconcile).toHaveBeenCalledOnce();dispose();
});
it("restricts task owner actions and keeps approval separate from task execution",async()=>{
  const {call,client,dispose}=setup();
  expect(()=>call("task-action","task","start",{})).toThrow();
  await call("task-action","task","answer",{eventId:"q",text:"Keep pending"});
  expect(client.request).toHaveBeenCalledWith("/tasks/task/answer","POST",{eventId:"q",text:"Keep pending"});
  expect(client.startTask).not.toHaveBeenCalled();dispose();
});
