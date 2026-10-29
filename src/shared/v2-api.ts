import type { Task, TaskCreateInput } from "./host-types";
import type { LaunchProfile } from "./launch-profile";
import type { HostRegistration, RemoteHostObservation, LocalHostConnection } from "./host-connection-types";

export interface V2TerminalSummary {id:string;kind:string;cwd:string;projectId:string|null;status:string;connected:boolean;observedAt:number|null;tabId:string|null;paneId:string|null;generation:string;createdAt:string;tokens?:Record<string,string>}
export interface V2HostState {tasks:Task[];terminals:V2TerminalSummary[];hosts?:RemoteHostObservation[];observedAt:number|null;connected:boolean}
export interface McwV2Api {
  readonly version: 1 | 2;
  enabled(): Promise<boolean>;
  configuration(): Promise<{hostId:string;launchProfiles:LaunchProfile[];defaultLaunchProfiles:Partial<Record<"claude"|"codex",string>>}>;
  listTasks():Promise<Task[]>;
  createTask(input:TaskCreateInput):Promise<Task>;
  inspectTask(id:string):Promise<Task>;
  taskAction(id:string,action:"acknowledge"|"answer"|"acknowledge-result"|"message"|"cancel",input:Record<string,unknown>):Promise<void>;
  onState?(listener:(state:V2HostState)=>void):()=>void;
  hostState?():Promise<V2HostState>;
  localConnection?():Promise<LocalHostConnection>;
  listHosts?():Promise<{registrations:HostRegistration[];observations:RemoteHostObservation[]}>;
  configureHost?(registration:HostRegistration):Promise<void>;
  removeHost?(hostId:string):Promise<void>;
  startTask(id:string,input:{repositoryPath:string;expectedHead:string}):Promise<unknown>;
  repositoryHead(directory:string):Promise<string>;
  listTerminals():Promise<V2TerminalSummary[]>;
  createTerminal(input:Record<string,unknown>):Promise<V2TerminalSummary>;
  subscribeTerminal(sessionId:string,onEvent:(event:unknown)=>void):()=>void;
  terminalCommand(sessionId:string,command:Record<string,unknown>):Promise<void>;
  recoveryStatus():Promise<{available:boolean;backupDirectory:string;reason?:string}>;
}
