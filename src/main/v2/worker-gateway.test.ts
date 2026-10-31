// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { HostWorkerGateway, hostSessionView, semanticInput } from "./worker-gateway";
import type {HostClient} from "../host/host-client";
import type {TerminalLaunchSpec} from "../../shared/terminal-types";
describe("host-owned sessions",()=>{
 it('admits a verified v1 backup session once while refusing a missing host-owned record',async()=>{
  const client={health:vi.fn(async()=>({})),tasks:vi.fn(async()=>[]),request:vi.fn(async()=>[]),terminals:vi.fn(async()=>[])};
  const gateway=new HostWorkerGateway(client as unknown as HostClient,new Set(['migrated']));
  expect(await gateway.resumeTarget('migrated')).toEqual({sessionId:'migrated'});
  await expect(gateway.resumeTarget('missing-host-session')).rejects.toThrow(/실행/);
 });
 it("retains the selected conversation on launch and includes the observed generation for explicit resume",async()=>{
  const previous={id:"s",kind:"claude",cwd:"/repo",projectId:null,createdAt:"2026-10-30T00:00:00Z",generation:"old",tabId:null,paneId:null,connected:true,status:"starting",observedAt:1,delivery:"rejected"};
  const client={health:vi.fn(async()=>({capabilities:{terminalRestart:true}})),tasks:vi.fn(async()=>[]),request:vi.fn(async()=>[]),terminals:vi.fn(async()=>[previous]),createTerminal:vi.fn(async()=>({...previous,generation:"new",delivery:"delivered"}))};
  const gateway=new HostWorkerGateway(client as unknown as HostClient);
  const target=await gateway.resumeTarget('s');
  const view=await gateway.create({...target,generation:"new",env:{},providerConversationId:"conversation"} as TerminalLaunchSpec);
  expect(view.providerConversationId).toBe("conversation");
  expect(client.createTerminal).toHaveBeenCalledWith(expect.objectContaining({restartGeneration:"old",generation:"new"}));
 });
 it('uses a deterministic successor with an existing v2.0.1 host and follows it even after the host is updated',async()=>{
  const original={id:'s',generation:'g',connected:true,delivery:'rejected',tabId:null,paneId:null,status:'starting'};
  const client={health:vi.fn(async()=>({})),tasks:vi.fn(async()=>[]),request:vi.fn(async()=>[]),terminals:vi.fn(async()=>[original]),createTerminal:vi.fn()};
  const gateway=new HostWorkerGateway(client as unknown as HostClient);
  const first=await gateway.resumeTarget('s'),second=await gateway.resumeTarget('s');
  expect(first).toEqual(second);expect(first.sessionId).not.toBe('s');expect(first).not.toHaveProperty('restartGeneration');
  expect(first.sessionId).toMatch(/^[a-f0-9-]{36}$/);
  client.terminals.mockResolvedValue([original,{...original,id:first.sessionId}]);
  expect(await gateway.resumeTarget('s')).toMatchObject({redirectSessionId:first.sessionId});
  client.health.mockResolvedValue({capabilities:{terminalRestart:true}});
  expect(await gateway.resumeTarget('s')).toMatchObject({redirectSessionId:first.sessionId});expect(client.createTerminal).not.toHaveBeenCalled();
 });
 it.each(['unknown','pending','delivered'])('rejects explicit resume while %s delivery may still run',async delivery=>{
  const client={health:vi.fn(async()=>({})),tasks:vi.fn(async()=>[]),request:vi.fn(async()=>[]),terminals:vi.fn(async()=>[{id:'s',generation:'g',connected:true,delivery,status:'idle'}])};
  await expect(new HostWorkerGateway(client as unknown as HostClient).resumeTarget('s')).rejects.toThrow(/실행/);
 });
 it('does not restart task attempts through the ordinary terminal resume action',async()=>{
  const client={health:vi.fn(async()=>({})),tasks:vi.fn(async()=>[{participants:[{attempt:{id:'s'},previousAttempts:[]}]}]),request:vi.fn(async()=>[]),terminals:vi.fn(async()=>[{id:'s',generation:'g',connected:true,delivery:'rejected',tabId:null,paneId:null,status:'starting'}])};
  await expect(new HostWorkerGateway(client as unknown as HostClient).resumeTarget('s')).rejects.toThrow(/협업/);
 });
 it("preserves idle as idle and does not call disconnected observations exited",()=>{
  const base={id:"s",kind:"codex",cwd:"/repo",projectId:null,createdAt:"2026-10-30T00:00:00Z",generation:"g",tabId:"w:t",paneId:"w:p",connected:true,status:"idle",observedAt:1};
  expect(hostSessionView(base).status).toBe("idle");
  expect(hostSessionView({...base,connected:false}).status).toBe("error");
  expect(hostSessionView({...base,status:"blocked"}).status).toBe("awaiting-input");
  expect(hostSessionView({...base,status:"unknown"}).status).toBe("unknown");
  expect(hostSessionView({...base,status:"unrecognized-future-state"}).status).toBe("unknown");
  expect(hostSessionView({...base,status:"starting"}).status).toBe("starting");
 });
 it("translates explicit text and Enter without forwarding raw terminal escapes",()=>{
  expect(semanticInput("한글\r")).toEqual([{TextCommit:"한글"},{Key:{code:"Enter",modifiers:0,kind:"Press",repeat_count:1,shifted_codepoint:null,generated_text:null,tracks_release:false,physical_key_id:null,windows_record:null}}]);
  expect(()=>semanticInput("\x1b[2J")).toThrow("Canvas");
 });
 it("shows a definitively rejected launch as an error instead of starting forever",()=>{
  const value={id:"s",kind:"claude",cwd:"/repo",projectId:null,createdAt:"2026-10-30T00:00:00Z",generation:"g",tabId:null,paneId:null,connected:true,status:"starting",observedAt:1,delivery:"rejected" as const};
  expect(hostSessionView(value).status).toBe("error");
  expect(hostSessionView({...value,delivery:"unknown"}).status).toBe("unknown");
 });
});
