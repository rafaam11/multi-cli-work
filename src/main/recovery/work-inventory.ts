import type {Task,TaskAttempt} from "../../shared/host-types";

export interface RecoveryReplicaObservation {ownerHostId:string;task:Task;identity:{taskId:string;hostId:string};attempt:TaskAttempt;pendingOperations:number}
export function attemptNeedsObservation(attempt:TaskAttempt):boolean{
  return ["running","idle","lost"].includes(attempt.execution)||["pending","unknown"].includes(attempt.delivery)||(attempt.delivery==="delivered"&&attempt.execution!=="exited");
}
/** Only unsettled work creates a live dependency. Historical, confirmed exits
 * cannot restart themselves and must not make an old offline PC mandatory forever. */
export function recoveryWorkInventory(hostId:string,tasks:Task[],replicas:RecoveryReplicaObservation[]){
  const related=new Map<string,Set<string>>(),unsettled=new Set<string>();let undeliveredOperations=0;
  const add=(remote:string,taskId:string)=>{if(remote===hostId)return;const ids=related.get(remote)??new Set<string>();ids.add(taskId);related.set(remote,ids);};
  for(const task of tasks){
    if(task.ownerHostId!==hostId)throw new Error("Recovery task owner differs");
    for(const participant of task.participants)if([participant.attempt,...participant.previousAttempts].some(attemptNeedsObservation)){
      unsettled.add(task.id);add(participant.hostId,task.id);
    }
  }
  for(const replica of replicas){
    if(replica.identity.hostId!==hostId||replica.ownerHostId===hostId||!Number.isSafeInteger(replica.pendingOperations)||replica.pendingOperations<0)throw new Error("Invalid recovery worker observation");
    undeliveredOperations+=replica.pendingOperations;
    if(attemptNeedsObservation(replica.attempt)||replica.attempt.delivery==="none"||replica.pendingOperations>0){
      unsettled.add(replica.identity.taskId);add(replica.ownerHostId,replica.identity.taskId);
    }
  }
  return {related:[...related].sort(([a],[b])=>a.localeCompare(b)).map(([hostId,ids])=>({hostId,taskIds:[...ids].sort()})),unsettledTaskIds:[...unsettled].sort(),undeliveredOperations};
}

export function recoveryTasksReady(hostId:string,taskIds:string[],tasks:Task[],replicas:RecoveryReplicaObservation[],sessions:unknown[]):{ready:boolean;missingTaskIds:string[]}{
  const selected=tasks.filter(task=>taskIds.includes(task.id)),workers=replicas.filter(replica=>taskIds.includes(replica.identity.taskId));
  const missingTaskIds=taskIds.filter(id=>!selected.some(task=>task.id===id)&&!workers.some(replica=>replica.identity.taskId===id));
  const localAttempts=selected.flatMap(task=>task.participants.filter(member=>member.hostId===hostId).flatMap(member=>[member.attempt,...member.previousAttempts])).concat(workers.map(worker=>worker.attempt));
  const unsettled=selected.some(task=>task.participants.some(member=>[member.attempt,...member.previousAttempts].some(attemptNeedsObservation)))||workers.some(worker=>attemptNeedsObservation(worker.attempt)||worker.pendingOperations>0);
  const unobserved=localAttempts.some(attempt=>{
    if(attempt.delivery!=="delivered")return false;
    const session=sessions.find(value=>value&&typeof value==="object"&&(value as Record<string,unknown>).id===attempt.id) as Record<string,unknown>|undefined;
    return !session||session.connected!==true||session.status!=="exited"||session.delivery!=="delivered";
  });
  return {ready:!missingTaskIds.length&&!unsettled&&!unobserved,missingTaskIds};
}
