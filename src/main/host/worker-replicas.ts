import {createHash,randomUUID} from "node:crypto";
import {EventEmitter} from "node:events";
import {setTimeout as delay} from "node:timers/promises";
import path from "node:path";
import type {AttemptRef,Task,TaskAgentChoice,TaskAttempt,TaskDelivery,TaskExecution,TaskIdentity,TaskInbox,TaskResultInput} from "../../shared/host-types";
import type {RegisteredTaskStart} from "../../shared/execution-catalog";
import type {RemoteTaskAction,RemoteTaskOperation} from "../../shared/remote-task-types";
import {readJsonStore,updateJsonStore,type JsonStoreSpec} from "../storage/json-store";
import {validateTaskAttempt,validateTaskIdentity,validateTaskId,validateTaskInteger,validateTaskSnapshot,validateTaskText} from "./task-validation";
import {sameTaskIdentity,taskResultKey,validateRemoteTaskOperation} from "./remote-operations";

export interface WorkerReplica {
  id:string;ownerHostId:string;identity:TaskIdentity;task:Task;selection:RegisteredTaskStart;
  observedAt:number;attempt:TaskAttempt;operations:{operation:RemoteTaskOperation;acknowledged:boolean}[];
}
interface Registry {version:1;hostId:string;replicas:WorkerReplica[]}
class ReplicaError extends Error {}
const clone=<T>(value:T):T=>structuredClone(value);
function keys(value:unknown,expected:string[]):asserts value is Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join(",")!==expected.sort().join(","))throw new ReplicaError("Invalid worker replica data");}
function sameJson(left:unknown,right:unknown):boolean{
  const stable=(value:unknown):unknown=>Array.isArray(value)?value.map(stable):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)])):value;
  return JSON.stringify(stable(left))===JSON.stringify(stable(right));
}
function selected(value:unknown):asserts value is RegisteredTaskStart{
  keys(value,["repositoryId","expectedPath","expectedHead"]);validateTaskId(value.repositoryId);validateTaskText(value.expectedPath,32768);
  if(!path.isAbsolute(value.expectedPath)||typeof value.expectedHead!=="string"||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.expectedHead))throw new ReplicaError("Invalid selected remote checkout");
}
export function replicaId(ownerHostId:string,identity:TaskIdentity):string{return createHash("sha256").update(JSON.stringify([ownerHostId,identity.taskId,identity.participantId,identity.attemptId,identity.generation,identity.hostId])).digest("hex");}
function member(task:Task,identity:TaskIdentity,current:boolean){
  const participant=task.participants.find(item=>item.id===identity.participantId);
  const attempts=participant?(current?[participant.attempt]:[participant.attempt,...participant.previousAttempts]):[];
  if(identity.taskId!==task.id||!participant||participant.hostId!==identity.hostId||participant.role!==identity.role||!attempts.some(attempt=>attempt.id===identity.attemptId&&attempt.generation===identity.generation))throw new ReplicaError("Unauthorized or stale worker attempt");
  return participant;
}
function committed(task:Task,operation:RemoteTaskOperation):boolean{
  const {action,source}=operation;
  if(action.kind==="result")return task.results.some(result=>sameTaskIdentity(result.source,source)&&(["summary","changes","verification","artifacts","issues"] as const).every(key=>sameJson(result[key],action.result[key])));
  const event=task.events.find(event=>event.id===operation.id);
  if(!event||!sameTaskIdentity(event.source,source)||event.text!==action.text)return false;
  if(action.kind==="message")return event.kind==="message"&&event.to===action.to;
  return event.kind==="question"&&task.questions.some(question=>question.id===event.id&&question.kind===action.kind);
}
function assertProgress(previous:Task,next:Task):void{
  if(previous.id!==next.id||previous.ownerHostId!==next.ownerHostId||previous.title!==next.title||previous.brief!==next.brief||previous.projectId!==next.projectId||next.events.length<previous.events.length||previous.events.some((event,index)=>!sameJson(event,next.events[index])))throw new ReplicaError("Stale or regressed owner snapshot");
  for(const prior of previous.participants){const current=next.participants.find(participant=>participant.id===prior.id);if(!current||current.role!==prior.role||current.hostId!==prior.hostId||current.profileId!==prior.profileId||current.provider!==prior.provider||current.attempt.generation<prior.attempt.generation)throw new ReplicaError("Regressed participant selection");}
  for(const prior of previous.questions){const current=next.questions.find(question=>question.id===prior.id);if(!current||!sameJson({...prior,acknowledged:null,answer:null},{...current,acknowledged:null,answer:null})||(prior.acknowledged&&!current.acknowledged)||(prior.answer!==null&&prior.answer!==current.answer))throw new ReplicaError("Regressed question receipt");}
  for(const prior of previous.results){const current=next.results.find(result=>result.id===prior.id);if(!current||!sameJson({...prior,review:null},{...current,review:null})||(prior.review==="acknowledged"&&current.review!=="acknowledged"))throw new ReplicaError("Regressed result receipt");}
  if(previous.cancellation==="requested"&&next.cancellation!=="requested")throw new ReplicaError("Regressed cancellation");
}
/** Remote workers have replicas, never local ownership or authority to elect/restart a lead. */
export class WorkerReplicas {
  readonly filePath:string;private readonly changes=new EventEmitter();private readonly spec:JsonStoreSpec<Registry>;
  constructor(readonly options:{directory:string;hostId:string}){
    validateTaskId(options.hostId);this.filePath=path.join(options.directory,"worker-replicas-v2.json");
    this.spec={label:"worker replicas",displayName:"원격 작업자 보존 기록",empty:()=>({version:1,hostId:options.hostId,replicas:[]}),error:(message,opts)=>new ReplicaError(message,opts),isContentError:error=>error instanceof ReplicaError,parse:value=>{
      try{
        keys(value,["version","hostId","replicas"]);
        if(value.version!==1||value.hostId!==options.hostId||!Array.isArray(value.replicas)||value.replicas.length>10000)throw new ReplicaError("Invalid worker replica registry");
        const ids=new Set<string>();
        for(const raw of value.replicas){
          keys(raw,["id","ownerHostId","identity","task","selection","observedAt","attempt","operations"]);
          const entry=raw as unknown as WorkerReplica;
          validateTaskId(entry.ownerHostId);validateTaskIdentity(entry.identity);selected(entry.selection);validateTaskInteger(entry.observedAt);validateTaskAttempt(entry.attempt);
          validateTaskSnapshot({schemaVersion:2,hostId:entry.ownerHostId,tasks:[entry.task],outbox:[]});member(entry.task,entry.identity,false);
          if(entry.ownerHostId===options.hostId||entry.identity.hostId!==options.hostId||entry.identity.role!=="worker"||entry.id!==replicaId(entry.ownerHostId,entry.identity)||ids.has(entry.id)||entry.attempt.id!==entry.identity.attemptId||entry.attempt.generation!==entry.identity.generation||!Array.isArray(entry.operations)||entry.operations.length>100000)throw new ReplicaError("Invalid worker replica scope");
          ids.add(entry.id);const operations=new Set<string>();let results=0;
          for(const receipt of entry.operations){keys(receipt,["operation","acknowledged"]);const operation=validateRemoteTaskOperation(receipt.operation);
            if(!sameTaskIdentity(operation.source,entry.identity)||operation.ownerHostId!==entry.ownerHostId||typeof receipt.acknowledged!=="boolean"||operations.has(operation.id)||(receipt.acknowledged&&!committed(entry.task,operation)))throw new ReplicaError("Invalid worker operation receipt");
            operations.add(operation.id);if(operation.action.kind==="result")results++;
          }
          if(results>1||(results===1)!==(entry.attempt.submittedResultId!==null)||(entry.attempt.submittedResultId!==null&&entry.attempt.submittedResultId!==taskResultKey(entry.identity)))throw new ReplicaError("Conflicting worker result");
        }
        return value as unknown as Registry;
      }catch(error){if(error instanceof ReplicaError)throw error;throw new ReplicaError("Invalid worker replica content",{cause:error});}
    }};
  }
  onChange(callback:()=>void):()=>void{this.changes.on("change",callback);return()=>this.changes.off("change",callback);}
  async list():Promise<WorkerReplica[]>{return clone((await readJsonStore(this.spec,this.filePath)).value.replicas);}
  async listForRecovery():Promise<WorkerReplica[]>{const stored=await readJsonStore(this.spec,this.filePath);if(!stored.writable)throw new ReplicaError(stored.warning??'Worker snapshot requires reconciliation');return clone(stored.value.replicas);}
  async get(id:string):Promise<WorkerReplica>{validateTaskId(id);const entry=(await this.list()).find(entry=>entry.id===id);if(!entry)throw new ReplicaError("Unknown worker replica");return entry;}
  private find(state:Registry,identity:TaskIdentity,current=true):WorkerReplica{validateTaskIdentity(identity);const entry=state.replicas.find(entry=>sameTaskIdentity(entry.identity,identity));if(!entry)throw new ReplicaError("Unknown worker identity");member(entry.task,identity,current);return entry;}
  private async update<T>(operation:(state:Registry)=>T):Promise<T>{let result!:T;await updateJsonStore(this.spec,this.filePath,state=>{result=operation(state);return state;});this.changes.emit("change");return clone(result);}
  async register(task:Task,identity:TaskIdentity,selection:RegisteredTaskStart):Promise<WorkerReplica>{
    validateTaskSnapshot({schemaVersion:2,hostId:task.ownerHostId,tasks:[task],outbox:[]});validateTaskIdentity(identity);selected(selection);const participant=member(task,identity,true);
    if(task.ownerHostId===this.options.hostId||identity.hostId!==this.options.hostId||identity.role!=="worker")throw new ReplicaError("Unauthorized worker replica registration");
    return this.update(state=>{
      const id=replicaId(task.ownerHostId,identity),existing=state.replicas.find(entry=>entry.id===id);
      if(existing){const prior=member(existing.task,identity,false);if(!sameJson(existing.selection,selection)||existing.task.brief!==task.brief||existing.task.ownerHostId!==task.ownerHostId||prior.provider!==participant.provider||prior.profileId!==participant.profileId)throw new ReplicaError("Conflicting worker registration");return existing;}
      if(state.replicas.some(entry=>sameTaskIdentity(entry.identity,identity))||task.cancellation!=="none"||participant.attempt.delivery!=="none"||participant.attempt.execution!=="not_started")throw new ReplicaError("Worker already admitted or task cancelled");
      const entry:WorkerReplica={id,ownerHostId:task.ownerHostId,identity:clone(identity),task:clone(task),selection:clone(selection),observedAt:Date.now(),attempt:clone(participant.attempt),operations:[]};state.replicas.push(entry);return entry;
    });
  }
  async pending(id:string):Promise<RemoteTaskOperation[]>{return (await this.get(id)).operations.filter(item=>!item.acknowledged).map(item=>item.operation);}
  async synchronize(id:string,task:Task,acknowledged:string[]):Promise<void>{
    validateTaskId(id);if(!Array.isArray(acknowledged)||acknowledged.length>100000)throw new ReplicaError("Invalid receipts");acknowledged.forEach(validateTaskId);
    await this.update(state=>{
      const entry=state.replicas.find(entry=>entry.id===id);if(!entry)throw new ReplicaError("Unknown worker replica");
      validateTaskSnapshot({schemaVersion:2,hostId:entry.ownerHostId,tasks:[task],outbox:[]});member(task,entry.identity,false);assertProgress(entry.task,task);
      for(const operationId of acknowledged){const receipt=entry.operations.find(receipt=>receipt.operation.id===operationId);if(!receipt||!committed(task,receipt.operation))throw new ReplicaError("Owner receipt is not committed in the task");receipt.acknowledged=true;}
      entry.task=clone(task);entry.observedAt=Date.now();
    });
  }
  async bind(ref:AttemptRef):Promise<TaskIdentity>{const entry=(await this.list()).find(entry=>entry.identity.taskId===ref.taskId&&entry.identity.participantId===ref.participantId&&entry.identity.attemptId===ref.attemptId&&entry.identity.generation===ref.generation);if(!entry)throw new ReplicaError("Unknown worker attempt");member(entry.task,entry.identity,true);return entry.identity;}
  async inspect(taskId:string,identity?:TaskIdentity):Promise<unknown>{if(!identity||identity.taskId!==taskId)throw new ReplicaError("Worker identity required");const entry=this.find({version:1,hostId:this.options.hostId,replicas:await this.list()},identity);return {...entry.task,remote:{ownerHostId:entry.ownerHostId,observedAt:entry.observedAt,connected:Date.now()-entry.observedAt<15000,pendingOperations:entry.operations.filter(item=>!item.acknowledged).length},localAttempt:entry.attempt};}
  async receive(identity:TaskIdentity,cursor=0):Promise<TaskInbox>{validateTaskInteger(cursor);const entry=this.find({version:1,hostId:this.options.hostId,replicas:await this.list()},identity);return {events:entry.task.events.filter(event=>event.sequence>cursor&&(event.recipients?event.recipients.some(recipient=>sameTaskIdentity(recipient,identity))||sameTaskIdentity(event.source,identity):identity.generation===1&&(event.to===null||event.to===identity.participantId||event.from===identity.participantId))),cursor:entry.task.events.length};}
  async wait(identity:TaskIdentity,cursor=0,timeoutMs=30000,signal?:AbortSignal):Promise<TaskInbox>{validateTaskInteger(timeoutMs);if(timeoutMs>60000)throw new ReplicaError("Wait exceeds 60 seconds");const deadline=Date.now()+timeoutMs;while(true){signal?.throwIfAborted();const inbox=await this.receive(identity,cursor);if(inbox.events.length||Date.now()>=deadline)return inbox;await delay(Math.min(100,deadline-Date.now()),undefined,{signal});}}
  private async enqueue(identity:TaskIdentity,action:RemoteTaskAction):Promise<unknown>{
    return this.update(state=>{
      const entry=this.find(state,identity);
      const operation=validateRemoteTaskOperation({id:action.kind==="result"?taskResultKey(identity):randomUUID(),ownerHostId:entry.ownerHostId,source:identity,action});
      if(action.kind==="message"&&action.to!==null&&!entry.task.participants.some(member=>member.id===action.to))throw new ReplicaError("Unknown message recipient");
      const prior=entry.operations.find(item=>item.operation.id===operation.id);
      if(prior&&!sameJson(prior.operation,operation))throw new ReplicaError("Conflicting worker result");
      if(!prior)entry.operations.push({operation:clone(operation),acknowledged:false});
      if(action.kind==="result")entry.attempt.submittedResultId=taskResultKey(identity);
      return {id:operation.id,delivery:prior?.acknowledged?"delivered":"queued",ownerHostId:entry.ownerHostId,...(action.kind==="result"?{result:{...action.result,integration:"unintegrated",review:"pending"}}:{})};
    });
  }
  message(identity:TaskIdentity,to:string|null,text:string):Promise<unknown>{return this.enqueue(identity,{kind:"message",to,text});}
  ask(identity:TaskIdentity,kind:"question"|"approval",text:string):Promise<unknown>{return this.enqueue(identity,{kind,text});}
  submitResult(identity:TaskIdentity,result:TaskResultInput):Promise<unknown>{return this.enqueue(identity,{kind:"result",result});}
  async assign(_identity:TaskIdentity,_choice:TaskAgentChoice):Promise<never>{throw new ReplicaError("Only the owner lead assigns workers");}
  async answer(_identity:TaskIdentity,_eventId:string,_text:string):Promise<never>{throw new ReplicaError("Only the owner lead or user answers questions");}
  async cancel(_identity:TaskIdentity):Promise<never>{throw new ReplicaError("Only the owner lead requests cancellation");}
  async beginDelivery(identity:TaskIdentity,commandId:string):Promise<TaskAttempt>{validateTaskId(commandId);return this.update(state=>{const entry=this.find(state,identity);if(entry.attempt.delivery!=="none"||entry.attempt.execution!=="not_started"||entry.task.cancellation!=="none")throw new ReplicaError("Worker delivery already attempted or cancelled");entry.attempt.delivery="pending";entry.attempt.commandId=commandId;return entry.attempt;});}
  async resolveDelivery(identity:TaskIdentity,commandId:string,delivery:Extract<TaskDelivery,"delivered"|"rejected"|"unknown">):Promise<void>{validateTaskId(commandId);if(!["delivered","rejected","unknown"].includes(delivery))throw new ReplicaError("Invalid delivery");await this.update(state=>{const {attempt}=this.find(state,identity,false);if(attempt.commandId!==commandId||!["pending","unknown"].includes(attempt.delivery))throw new ReplicaError("Command does not match unresolved delivery");attempt.delivery=delivery;});}
  async observeExecution(identity:TaskIdentity,execution:TaskExecution):Promise<void>{if(!["not_started","running","idle","exited","lost"].includes(execution))throw new ReplicaError("Invalid execution state");await this.update(state=>{const {attempt}=this.find(state,identity,false);attempt.execution=execution;if(execution!=="lost")attempt.observedAt=Date.now();});}
  async recover():Promise<void>{await this.update(state=>{for(const {attempt} of state.replicas){if(attempt.delivery==="pending")attempt.delivery="unknown";if(["running","idle"].includes(attempt.execution))attempt.execution="lost";}});}
}
