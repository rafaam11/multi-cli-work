import type { TerminalSession, TerminalWorkerEvent, TerminalLaunchSpec, TerminalAttachment } from "../../shared/terminal-types";
import type { V2TerminalSummary } from "../../shared/v2-api";
import type { ClientPaneInputEvent } from "../../shared/herdr-surface-types";
import type { TerminalWorkerGateway } from "../terminal/terminal-coordinator";
import { HostClient } from "../host/host-client";
import { observedTerminals, type ObservedTerminal } from "./observed-terminals";
import type { RemoteHostObservation } from "../../shared/host-connection-types";
import {createHash} from 'node:crypto';

export function legacySuccessorId(id:string,generation:string):string {
  const hex=createHash('sha256').update(JSON.stringify(['mcw-terminal-resume-v1',id,generation])).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export function hostSessionView(value:ObservedTerminal):TerminalSession {
  const status = value.delivery==="rejected" ? "error" : !value.connected ? "error" : value.delivery==="unknown" ? "unknown" : value.status==="blocked" ? "awaiting-input" : value.status==="working" ? "working" : value.status==="exited" ? "exited" : ["idle","done"].includes(value.status) ? "idle" : value.status==="starting" ? "starting" : "unknown";
  // Zero explicitly means a host-managed process; this GUI does not own or signal an OS PID.
  return {id:value.id,projectId:value.projectId,kind:value.kind,cwd:value.cwd,tool:null,providerConversationId:value.providerConversationId??null,hostDelivery:value.delivery,status,pid:0,createdAt:value.createdAt,updatedAt:value.observedAt?new Date(value.observedAt).toISOString():value.createdAt,exitCode:null,...(value.remote?{remote:value.remote}:{}),taskNotice:value.taskNotice??null};
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
  constructor(readonly client:HostClient,private readonly migratedSessionIds:ReadonlySet<string>=new Set()) {}
  async resumeTarget(id:string):Promise<{sessionId:string;restartGeneration?:string;redirectSessionId?:string}> {
    // This route forces the old host to refresh Herdr and native process evidence;
    // canShutdown itself may be false while other terminals continue working.
    await this.client.request('/recovery-readiness');
    const [health,terminals,tasks,workers]=await Promise.all([this.client.health(),this.client.terminals() as Promise<(V2TerminalSummary&{processes?:unknown[]})[]>,this.client.tasks(),this.client.request<{identity:{attemptId:string};attempt:{id:string}}[]>('/workers')]);
    if(tasks.some(task=>task.participants.some(member=>[member.attempt,...member.previousAttempts].some(attempt=>attempt.id===id)))||workers.some(worker=>worker.identity.attemptId===id||worker.attempt.id===id))throw new Error('협업 작업의 실행 시도는 일반 세션 재개로 다시 실행할 수 없습니다. 작업 화면에서 확인하세요.');
    const previous=terminals.find(session=>session.id===id);
    // Only records in the verified pre-v2 backup may be admitted for the first
    // time. A missing host-owned record is not proof that its process exited.
    if(!previous&&this.migratedSessionIds.has(id))return {sessionId:id};
    if(!previous?.connected||!(previous.delivery==='rejected'&&!previous.tabId&&!previous.paneId&&!previous.processes?.length||previous.delivery==='delivered'&&previous.status==='exited'))throw new Error('실행 종료 또는 실행 거절을 확인하지 못했습니다. 연결과 실행 상태를 먼저 확인하세요.');
    const successor=legacySuccessorId(id,previous.generation);
    // Check lineage before capabilities: a newer host must not restart A while
    // the conversation already continues in its legacy successor B.
    if(terminals.some(session=>session.id===successor))return {sessionId:successor,redirectSessionId:successor};
    return health.capabilities?.terminalRestart===true?{sessionId:id,restartGeneration:previous.generation}:{sessionId:successor};
  }
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
    // This is an explicit renderer launch/resume. The host rechecks process exit
    // and the exact old generation atomically before admitting a replacement.
    const view=hostSessionView(await this.client.createTerminal({...spec,env}) as V2TerminalSummary);
    return {...view,providerConversationId:view.providerConversationId??spec.providerConversationId??null};
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
