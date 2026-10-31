import type { Task, TaskCreateInput } from "./host-types";
import type { LaunchProfile } from "./launch-profile";
import type { HostRegistration, RemoteHostObservation, LocalHostConnection } from "./host-connection-types";
import type {ExecutionCatalog,RepositoryInspection,RegisteredTaskStart,ExecutionHost} from "./execution-catalog";
import type {RemoteWorkerSelection} from "./remote-task-types";

export interface V2TerminalSummary {id:string;kind:string;cwd:string;projectId:string|null;status:string;connected:boolean;observedAt:number|null;tabId:string|null;paneId:string|null;generation:string;createdAt:string;providerConversationId?:string|null;delivery?:"pending"|"delivered"|"unknown"|"rejected";tokens?:Record<string,string>}
export interface V2HostState {tasks:Task[];terminals:V2TerminalSummary[];hosts?:RemoteHostObservation[];observedAt:number|null;connected:boolean}
export interface McwV2Api {
  readonly version: 1 | 2;
  enabled(): Promise<boolean>;
  configuration(): Promise<{hostId:string;launchProfiles:LaunchProfile[];defaultLaunchProfiles:Partial<Record<"claude"|"codex",string>>}>;
  listTasks(hostId?:string):Promise<Task[]>;
  createTask(input:TaskCreateInput,hostId?:string):Promise<Task>;
  executionCatalog?(hostId:string):Promise<ExecutionCatalog>;
  inspectHostRepository?(repositoryId:string,hostId:string):Promise<RepositoryInspection>;
  executionHosts?(ownerHostId?:string):Promise<ExecutionHost[]>;
  workerCatalog?(workerHostId:string,ownerHostId?:string):Promise<ExecutionCatalog>;
  inspectWorkerRepository?(repositoryId:string,workerHostId:string,ownerHostId?:string):Promise<RepositoryInspection>;
  startRegisteredTask?(id:string,input:RegisteredTaskStart&{remoteWorkers?:RemoteWorkerSelection[]},hostId:string):Promise<unknown>;
  inspectTask(id:string,hostId?:string):Promise<Task>;
  taskAction(id:string,action:"acknowledge"|"answer"|"acknowledge-result"|"message"|"cancel",input:Record<string,unknown>,hostId?:string):Promise<void>;
  terminalViewId?(sessionId:string,hostId:string):Promise<string>;
  onState?(listener:(state:V2HostState)=>void):()=>void;
  hostState?():Promise<V2HostState>;
  localConnection?():Promise<LocalHostConnection>;
  listHosts?():Promise<{registrations:HostRegistration[];observations:RemoteHostObservation[]}>;
  configureHost?(registration:HostRegistration):Promise<void>;
  removeHost?(hostId:string):Promise<void>;
  startTask(id:string,input:{repositoryPath:string;expectedHead:string;remoteWorkers?:RemoteWorkerSelection[]}):Promise<unknown>;
  repositoryHead(directory:string):Promise<string>;
  listTerminals():Promise<V2TerminalSummary[]>;
  createTerminal(input:Record<string,unknown>):Promise<V2TerminalSummary>;
  subscribeTerminal(sessionId:string,onEvent:(event:unknown)=>void):()=>void;
  terminalCommand(sessionId:string,command:Record<string,unknown>):Promise<void>;
  recoveryStatus():Promise<import('./recovery-types').RecoveryStatus>;
  beginRecovery?():Promise<import('./recovery-types').RecoveryStatus>;
  cancelRecovery?():Promise<import('./recovery-types').RecoveryStatus>;
  openRecovery?():Promise<void>;
}
