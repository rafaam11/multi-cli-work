import type { Task } from "./host-types";
import type { V2TerminalSummary } from "./v2-api";

export interface SshHostConfiguration {
  hostId:string;destination:string;username?:string;port?:number;identityFile?:string;knownHostsFile?:string;
  platform:"linux"|"win32";nodeExecutable:string;hostEntrypoint:string;dataRoot:string;
}
export interface HostRegistration {name:string;ssh:SshHostConfiguration;enabled:boolean}
export interface RemoteHostObservation {
  hostId:string;name:string;enabled:boolean;connected:boolean;observedAt:number|null;error:string|null;
  tasks:Task[];terminals:V2TerminalSummary[];
  catalog?:import('./execution-catalog').ExecutionCatalog;
}
export type LocalHostConnection = Pick<SshHostConfiguration,"hostId"|"platform"|"nodeExecutable"|"hostEntrypoint"|"dataRoot">;
