import type { TerminalSession, TerminalWorkerEvent, TerminalLaunchSpec, TerminalAttachment } from "../../shared/terminal-types";
import type { V2TerminalSummary } from "../../shared/v2-api";
import type { ClientPaneInputEvent } from "../../shared/herdr-surface-types";
import type { TerminalWorkerGateway } from "../terminal/terminal-coordinator";
import { HostClient } from "../host/host-client";
import { observedTerminals, type ObservedTerminal } from "./observed-terminals";
import type { RemoteHostObservation } from "../../shared/host-connection-types";

export function hostSessionView(value:ObservedTerminal):TerminalSession {
  const status = !value.connected ? "error" : value.status==="blocked" ? "awaiting-input" : value.status==="working" ? "working" : value.status==="exited" ? "exited" : ["idle","done"].includes(value.status) ? "idle" : value.status==="starting" ? "starting" : "unknown";
  // Zero explicitly means a host-managed process; this GUI does not own or signal an OS PID.
  return {id:value.id,projectId:value.projectId,kind:value.kind,cwd:value.cwd,tool:null,providerConversationId:null,status,pid:0,createdAt:value.createdAt,updatedAt:value.observedAt?new Date(value.observedAt).toISOString():value.createdAt,exitCode:null,...(value.remote?{remote:value.remote}:{}),taskNotice:value.taskNotice??null};
}
export function semanticInput(data:string):ClientPaneInputEvent[] {
  if(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(data)) throw new Error("이 입력은 Canvas 터미널에서 직접 실행하세요.");
  const result:ClientPaneInputEvent[]=[];
  const segments=data.split(/(\r\n|\r|\n)/);
  for(const text of segments) {
    if(!text)continue;
    if(/^[\r\n]+$/.test(text)) result.push({Key:{code:"Enter",modifiers:0,kind:"Press",repeat_count:1,shifted_codepoint:null,generated_text:null,tracks_release:false,physical_key_id:null,windows_record:null}});
    else result.push({TextCommit:text});
  }
  return result;
}
export class HostWorkerGateway implements TerminalWorkerGateway {
  private listeners=new Set<(event:TerminalWorkerEvent)=>void>();
  constructor(readonly client:HostClient) {}
  async listExisting(){
    const [terminals,tasks,{observations:hosts}]=await Promise.all([this.client.terminals() as Promise<V2TerminalSummary[]>,this.client.tasks(),this.client.request<{observations:RemoteHostObservation[]}>("/hosts")]);
    return observedTerminals({tasks,terminals,hosts}).map(s=>({...hostSessionView(s),generation:s.generation}));
  }
  async holdCheckoutRemoval(cwd:string,id:string):Promise<import("../projects/worktree-service").WorktreeRemovalLease> {
    await this.client.request("/checkout-removal/acquire","POST",{cwd,id,pid:process.pid});
    const release=async()=>{await this.settleCheckoutRemoval(id);};
    release.removeGit=async(repo:string,cwd:string,force:boolean)=>{await this.client.request("/checkout-removal/remove","POST",{id,repo,cwd,force});};
    return release;
  }
  async settleCheckoutRemoval(id:string):Promise<void>{await this.client.request("/checkout-removal/release","POST",{id});}
  async create(spec:TerminalLaunchSpec) {
    const env=Object.fromEntries(Object.entries(spec.env).filter(([key])=>!/^HERDR_|^MCW_HERDR_|^MULTI_CLI_WORK_CONTROL_|^JK_/i.test(key)));
    return hostSessionView(await this.client.createTerminal({...spec,env}) as V2TerminalSummary);
  }
  async attach(id:string):Promise<TerminalAttachment> {
    const found=(await this.listExisting()).find(s=>s.id===id);
    if(!found)throw new Error("호스트 세션을 찾을 수 없습니다.");
    return {session:found,replay:"",sequence:0};
  }
  async write(_id:string,_data:string):Promise<void> {throw new Error("Herdr 세션의 입력은 제어권을 가진 Canvas 터미널에서 전송하세요.");}
  async resize():Promise<void> { /* The authenticated Canvas owner sizes the shared host endpoint. */ }
  async stop(id:string){await this.client.stopTerminal(id);for(const listener of this.listeners)listener({type:"exit",sessionId:id,exitCode:0});}
  async release():Promise<void> { /* Releasing a GUI reference never terminates host work. */ }
  onEvent(listener:(event:TerminalWorkerEvent)=>void){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  onExit(_listener:(code:number)=>void){return ()=>{};}
  dispose(){this.listeners.clear();}
}
