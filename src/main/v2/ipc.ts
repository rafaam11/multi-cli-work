import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { LaunchProfile } from "../../shared/launch-profile";
import type { McwV2Api, V2HostState } from "../../shared/v2-api";
import type { HostClient, HostTerminalSocket } from "../host/host-client";
import { ownerTaskRoute } from "../host/host-client";
import { remoteSessionId, resolveRemoteSession } from "./observed-terminals";
const exec = promisify(execFile);
export async function readV2RepositoryHead(directory:string):Promise<string>{
  if(typeof directory!=="string"||!path.isAbsolute(directory)||directory.includes("\0"))throw new Error("저장소 절대 경로가 필요합니다.");
  return (await exec("git",["-C",directory,"rev-parse","--verify","HEAD"],{windowsHide:true,timeout:10000,maxBuffer:4096})).stdout.trim();
}

export interface V2IpcOptions {
  ipc: Pick<IpcMain, "handle" | "removeHandler">;
  authorize(event: IpcMainInvokeEvent): boolean;
  send(channel: string, ...args: unknown[]): void;
  client: HostClient; hostId: string; backupDirectory: string;
  configuration(): Promise<{ launchProfiles: LaunchProfile[]; defaultLaunchProfiles: Partial<Record<"claude" | "codex", string>> }>;
  executable(provider: "claude" | "codex"): Promise<string | null>;
  reconcile(): Promise<void>;
  state?(): V2HostState;
  refresh?(): Promise<void>;
  repositoryProjectId?(directory:string): Promise<string|null>;
}
export function registerV2Ipc(options: V2IpcOptions): () => void {
  type Viewer = {socket?:HostTerminalSocket;references:Set<string>;ready:boolean;epoch:number;retry?:ReturnType<typeof setTimeout>;observedAt:number|null};
  const channels: string[] = [], viewers = new Map<string, Viewer>();
  const closeViewer = (viewer:Viewer) => {viewer.epoch++;viewer.ready=false;clearTimeout(viewer.retry);viewer.socket?.close();};
  const connectViewer = (id:string,viewer:Viewer) => {
    const epoch=++viewer.epoch;
    const retry = () => {const expected=viewer.epoch;viewer.retry=setTimeout(async()=>{
      try {await options.refresh?.();if(viewers.get(id)===viewer && expected===viewer.epoch)connectViewer(id,viewer);}
      catch {if(viewers.get(id)===viewer && expected===viewer.epoch)retry();}
    },1000);};
    viewer.socket=options.client.terminalSocket(id,event=>{
      if(viewers.get(id)!==viewer || epoch!==viewer.epoch)return;
      const value=event as {type?:string};
      if(value.type==="authenticated")viewer.ready=true;
      if(value.type==="snapshot" || value.type==="frame")viewer.observedAt=Date.now();
      if(value.type==="disconnected"){
        viewer.epoch++;viewer.ready=false;viewer.socket?.close();
        options.send("v2:terminal-event",id,{...value,observedAt:viewer.observedAt});
        retry();return;
      }
      options.send("v2:terminal-event",id,event);
    },message=>{if(viewers.get(id)===viewer && epoch===viewer.epoch)options.send("v2:terminal-event",id,{type:"error",error:message});});
  };
  const handle = (name: string, fn: (...args: any[]) => unknown) => {
    const channel = `v2:${name}`; channels.push(channel);
    options.ipc.handle(channel, (event, ...args) => { if (!options.authorize(event)) throw new Error("Untrusted v2 IPC sender"); return fn(...args); });
  };
  handle("enabled", () => true);
  handle("host-state", () => options.state?.() ?? {tasks:[],terminals:[],observedAt:null,connected:false});
  handle("local-connection",()=>options.client.request("/connection"));
  handle("hosts",()=>options.client.request("/hosts"));
  handle("host-configure",registration=>options.client.request("/hosts","POST",registration));
  handle("host-remove",(hostId:string)=>{if(typeof hostId!=="string"||!/^[\w-]{1,128}$/.test(hostId))throw new Error("Invalid host ID");return options.client.request(`/hosts/${encodeURIComponent(hostId)}`,"DELETE");});
  handle("configuration", async () => ({ hostId: options.hostId, ...await options.configuration() }));
  handle("tasks", (hostId?:string) => {ownerTaskRoute(undefined,hostId);return options.client.tasks(hostId);});
  handle("task-create", (input,hostId?:string) => {ownerTaskRoute(undefined,hostId);return options.client.createTask(input,hostId);});
  handle("execution-catalog",(hostId:string)=>{const prefix=ownerTaskRoute(undefined,hostId).replace(/\/tasks$/,"/execution-catalog");return options.client.request(prefix);});
  handle("host-repository",(repositoryId:string,hostId:string)=>{
    if(typeof repositoryId!=="string"||!repositoryId||repositoryId.length>200||repositoryId.includes("\0"))throw new Error("Invalid repository ID");
    const prefix=ownerTaskRoute(undefined,hostId).replace(/\/tasks$/,"/execution-catalog");return options.client.request(`${prefix}/repositories/${encodeURIComponent(repositoryId)}`);
  });
  handle("task-start-registered",async(id:string,input:Record<string,unknown>,hostId:string)=>{
    const route=ownerTaskRoute(id,hostId);
    if(!hostId||!input||typeof input!=="object"||Object.keys(input).some(key=>!["repositoryId","expectedHead","expectedPath"].includes(key))||[input.repositoryId,input.expectedHead,input.expectedPath].some(value=>typeof value!=="string"))throw new Error("원격 저장소와 기준 커밋을 확인하세요.");
    const result=await options.client.request(`${route}/start`,"POST",input);await options.reconcile();return result;
  });
  handle("task-inspect", (id:string,hostId?:string) => {ownerTaskRoute(id,hostId);return options.client.inspectTask(id,hostId);});
  handle("task-action", (id:string,action:string,input:Record<string,unknown>,hostId?:string)=>{
    if(!["acknowledge","answer","acknowledge-result","message","cancel"].includes(action))throw new Error("Unknown task action");
    return options.client.request(`${ownerTaskRoute(id,hostId)}/${action}`,"POST",input);
  });
  handle("terminal-view-id",(sessionId:string,hostId:string)=>{
    if(typeof sessionId!=="string"||!/^[\w-]{1,128}$/.test(sessionId))throw new Error("Invalid session ID");
    ownerTaskRoute(undefined,hostId);
    const viewId=remoteSessionId(hostId,sessionId);
    resolveRemoteSession(options.state?.().hosts??[],viewId);return viewId;
  });
  handle("task-start", async (id: string, input: { repositoryPath: string; expectedHead: string }) => {
    if (!input || typeof input.repositoryPath !== "string" || typeof input.expectedHead !== "string" || Object.keys(input).some(key => !["repositoryPath", "expectedHead"].includes(key))) throw new Error("작업 시작 정보가 올바르지 않습니다.");
    const task = await options.client.inspectTask(id), configuration = await options.configuration();
    const profiles = await Promise.all(task.participants.map(async member => {
      const profile = configuration.launchProfiles.find(profile => profile.id === member.profileId && profile.agentId === member.provider);
      const executable = await options.executable(member.provider);
      if (!profile || !executable) throw new Error(`선택한 ${member.provider} 프로필 또는 실행 파일을 찾을 수 없습니다.`);
      return { participantId: member.id, profile, executable };
    }));
    const projectId=await options.repositoryProjectId?.(input.repositoryPath)??null;
    const result = await options.client.startTask(id, { ...input, profiles, projectId });
    await options.reconcile(); return result;
  });
  handle("repository-head",readV2RepositoryHead);
  handle("terminals", () => options.client.terminals());
  handle("terminal-create", async input => { const result = await options.client.createTerminal(input); await options.reconcile(); return result; });
  handle("terminal-subscribe", (id: string, reference: string) => {
    if (typeof id !== "string" || !/^[\w-]{1,128}$/.test(id) || typeof reference !== "string" || reference.length > 128) throw new Error("Invalid viewer");
    let viewer = viewers.get(id);
    if (!viewer) {
      viewer = { references: new Set(),ready:false,epoch:0,observedAt:null };
      viewers.set(id, viewer);
      connectViewer(id,viewer);
    }
    viewer.references.add(reference);
  });
  handle("terminal-unsubscribe", (id: string, reference: string) => { const viewer = viewers.get(id); viewer?.references.delete(reference); if (viewer && !viewer.references.size) { closeViewer(viewer); viewers.delete(id); } });
  handle("terminal-command", (id: string, command: Record<string, unknown>) => {
    const viewer = viewers.get(id); if (!viewer) throw new Error("Terminal viewer not attached");
    if (!command || !["snapshot", "input", "resize", "scroll", "takeOwnership", "releaseOwnership"].includes(String(command.type))) throw new Error("Invalid terminal command");
    if (!viewer.ready) {if(command.type==="snapshot")return;throw new Error("호스트 연결이 복구되면 제어권을 다시 요청하세요.");}
    viewer.socket!.send(command);
  });
  handle("recovery-status", (): Awaited<ReturnType<McwV2Api["recoveryStatus"]>> => ({ available: false, backupDirectory: options.backupDirectory, reason: "독립 복구본을 보존했습니다. 설치 왕복 검증 후 앱에서 복귀를 활성화합니다." }));
  return () => { for (const viewer of viewers.values()) closeViewer(viewer); viewers.clear(); for (const channel of channels) options.ipc.removeHandler(channel); };
}
