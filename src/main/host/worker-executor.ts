import {access} from "node:fs/promises";
import path from "node:path";
import type {Task,TaskIdentity} from "../../shared/host-types";
import type {RegisteredTaskStart} from "../../shared/execution-catalog";
import {prepareTaskWorkspace} from "./execution-workspace";
import {launchTaskParticipant,type ParticipantLaunchOptions} from "./task-executor";
import type {HostExecutionCatalog} from "./execution-catalog";
import {WorkerReplicas} from "./worker-replicas";
import {validateTaskId} from "./task-validation";

export interface WorkerExecutorOptions extends Omit<ParticipantLaunchOptions,"store"|"inspectAttempt"> {
  replicas:WorkerReplicas;catalog:Pick<HostExecutionCatalog,"prepareWorker">;
}
/** A remote host admits only one explicitly selected worker attempt, never an entire foreign task. */
export class WorkerExecutor {
  private readonly starting=new Set<string>();
  constructor(readonly options:WorkerExecutorOptions){}
  private async workspace(task:Task,identity:TaskIdentity,selection:RegisteredTaskStart){
    const input=await this.options.catalog.prepareWorker(task,identity,selection);
    const participant=task.participants.find(member=>member.id===identity.participantId)!;
    const profile=input.profiles.find(profile=>profile.participantId===participant.id);
    if(!profile||profile.profile.id!==participant.profileId||profile.profile.agentId!==participant.provider)throw new Error("Selected worker profile changed");
    await Promise.all([access(profile.executable),access(this.options.mcpClientPath)]);
    const workspace=await prepareTaskWorkspace({ownedRoot:path.join(this.options.directory,"remote-workspaces"),taskId:task.id,participantId:participant.id,role:"worker",repositoryPath:input.repositoryPath,expectedHead:input.expectedHead,brief:task.brief,provider:participant.provider,profileId:participant.profileId});
    return {participant,profile,workspace,projectId:input.projectId??null};
  }
  async prepare(task:Task,identity:TaskIdentity,selection:RegisteredTaskStart){
    await this.workspace(task,identity,selection);
    return this.options.replicas.register(task,identity,selection);
  }
  async admit(id:string,commandId:string,task:Task){
    validateTaskId(id);validateTaskId(commandId);
    if(this.starting.has(id))throw new Error("Worker admission is already in progress");this.starting.add(id);
    try{
      const record=await this.options.replicas.get(id),identity=record.identity;
      if(record.attempt.delivery!=="none"||record.attempt.execution!=="not_started")throw new Error("Worker delivery already attempted; reconcile without replay");
      const intent=task.participants.find(member=>member.id===identity.participantId)?.attempt;
      if(task.id!==identity.taskId||task.ownerHostId!==record.ownerHostId||task.cancellation!=="none"||intent?.id!==identity.attemptId||intent.generation!==identity.generation||intent.commandId!==commandId||intent.delivery!=="pending")throw new Error("Owner admission intent does not match worker attempt");
      await this.options.replicas.synchronize(id,task,[]);
      try{
        const prepared=await this.workspace(task,identity,record.selection);
        const terminal=await launchTaskParticipant({...this.options,store:this.options.replicas,inspectAttempt:async()=> (await this.options.replicas.get(id)).attempt},task,prepared.participant,prepared.workspace,prepared.profile,prepared.projectId,commandId);
        return {replicaId:id,terminal,attempt:(await this.options.replicas.get(id)).attempt};
      }catch(error){
        // Preparation/configuration can fail before the broker is called. Persist
        // that proven rejection so a lost HTTP reply can be reconciled safely.
        if((await this.options.replicas.get(id)).attempt.delivery==="none"){
          await this.options.replicas.beginDelivery(identity,commandId);
          await this.options.replicas.resolveDelivery(identity,commandId,"rejected");
        }
        throw error;
      }
    }finally{this.starting.delete(id);}
  }
  async reconcile():Promise<void>{
    const sessions=await this.options.terminals.list() as Record<string,unknown>[];
    for(const record of await this.options.replicas.list()){
      const {identity,attempt}=record;if(attempt.delivery==="none")continue;
      const session=sessions.find(session=>session.id===identity.attemptId&&session.generation===`${identity.attemptId}-${identity.generation}`);
      if(!session||session.connected!==true){if(["running","idle"].includes(attempt.execution))await this.options.replicas.observeExecution(identity,"lost");continue;}
      if(["pending","unknown"].includes(attempt.delivery)&&attempt.commandId&&["delivered","rejected"].includes(session.delivery as string))await this.options.replicas.resolveDelivery(identity,attempt.commandId,session.delivery as "delivered"|"rejected");
      if(session.delivery==="delivered"){
        const execution=session.status==="exited"?"exited":session.status==="idle"?"idle":"running";
        if(attempt.execution!==execution)await this.options.replicas.observeExecution(identity,execution);
      }
    }
  }
}
