import { createHash } from "node:crypto";
import type { V2HostState, V2TerminalSummary } from "../../shared/v2-api";
import { taskSessionNotices, type TaskSessionNotice } from "../../shared/task-notices";
import type { RemoteHostObservation } from "../../shared/host-connection-types";

export function remoteSessionId(hostId:string,sessionId:string):string {
  return `mcwr-${createHash("sha256").update(JSON.stringify([hostId,sessionId])).digest("hex")}`;
}
export interface ObservedTerminal extends V2TerminalSummary {
  remote?:import("../../shared/terminal-types").RemoteTerminalSource;
  taskNotice?:TaskSessionNotice|null;
}
export function observedTaskNotices(state:Pick<V2HostState,"tasks"|"hosts">) {
  return [{tasks:state.tasks,hostId:null as string|null,name:null as string|null,connected:true},
    ...(state.hosts??[]).map(host=>({tasks:host.tasks,hostId:host.hostId,name:host.name,connected:host.connected}))]
    .flatMap(source=>source.tasks.flatMap(task=>Object.entries(taskSessionNotices([task])).map(([id,notice])=>({
      sessionId:source.hostId?remoteSessionId(source.hostId,id):id,task,notice,hostId:source.hostId,hostName:source.name,connected:source.connected
    }))));
}
/** IDs are bounded filesystem-safe view keys. Remote repository IDs never alias local folders. */
export function observedTerminals(state:Pick<V2HostState,"tasks"|"terminals"|"hosts">):ObservedTerminal[] {
  const notices=Object.fromEntries(observedTaskNotices(state).map(entry=>[entry.sessionId,entry.notice]));
  return [...state.terminals.map(terminal=>({...terminal,taskNotice:notices[terminal.id]??null})),
    ...(state.hosts??[]).flatMap(host=>{
      return host.terminals.map(terminal=>({...terminal,id:remoteSessionId(host.hostId,terminal.id),projectId:null,
        connected:host.connected&&terminal.connected,taskNotice:notices[remoteSessionId(host.hostId,terminal.id)]??null,
        remote:{hostId:host.hostId,name:host.name,sessionId:terminal.id,projectId:terminal.projectId,connected:host.connected&&terminal.connected,observedAt:terminal.observedAt,repository:host.catalog?.repositories.find(repo=>repo.id===terminal.projectId)}}));
    })];
}
export function resolveRemoteSession(hosts:RemoteHostObservation[],viewId:string) {
  for(const host of hosts)for(const terminal of host.terminals)if(remoteSessionId(host.hostId,terminal.id)===viewId)return {host,terminal};
  throw new Error("Remote terminal is not registered");
}
