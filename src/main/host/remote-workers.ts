import {randomUUID} from "node:crypto";
import path from "node:path";
import type {Task,TaskIdentity} from "../../shared/host-types";
import type {RegisteredTaskStart} from "../../shared/execution-catalog";
import type {WorkerTransfer} from "../../shared/remote-task-types";
import {readJsonStore,updateJsonStore,type JsonStoreSpec} from "../storage/json-store";
import {TaskStore} from "./task-store";
import type {HostClient} from "./host-client";
import {replicaId} from "./worker-replicas";
import {sameTaskIdentity,validateRemoteTaskOperation} from "./remote-operations";
import {validateTaskAttempt,validateTaskIdentity,validateTaskSnapshot} from "./task-validation";

interface Placement {id:string;ownerHostId:string;identity:TaskIdentity;selection:RegisteredTaskStart}
interface Registry {version:1;hostId:string;placements:Placement[]}
class DispatchError extends Error {}
function object(value:unknown,fields:string[]):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join(",")!==fields.sort().join(","))throw new DispatchError("Invalid remote worker record");return value as Record<string,unknown>;
}
export function validateRemoteSelection(value:unknown):asserts value is RegisteredTaskStart{
  const input=object(value,["repositoryId","expectedPath","expectedHead"]);
  if(typeof input.repositoryId!=="string"||!input.repositoryId||input.repositoryId.length>200||typeof input.expectedPath!=="string"||input.expectedPath.length>32768||input.expectedPath.includes("\0")||(!path.posix.isAbsolute(input.expectedPath)&&!path.win32.isAbsolute(input.expectedPath))||typeof input.expectedHead!=="string"||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(input.expectedHead))throw new DispatchError("Invalid selected remote checkout");
}
const selection:typeof validateRemoteSelection=validateRemoteSelection;
function sameSelection(a:RegisteredTaskStart,b:RegisteredTaskStart){return a.repositoryId===b.repositoryId&&a.expectedPath===b.expectedPath&&a.expectedHead===b.expectedHead;}
/** The owner coordinates durable data transfer. Execution admission is always an explicit, one-shot call. */
export class RemoteWorkers {
  private readonly file:string;private readonly spec:JsonStoreSpec<Registry>;private readonly admitting=new Set<string>();private synchronization?:Promise<void>;
  constructor(readonly options:{directory:string;store:TaskStore;client(hostId:string):Pick<HostClient,"request">}){
    this.file=path.join(options.directory,"remote-workers-v2.json");
    this.spec={label:"remote workers",displayName:"원격 작업자 배정",empty:()=>({version:1,hostId:options.store.options.hostId,placements:[]}),error:(message,opts)=>new DispatchError(message,opts),isContentError:error=>error instanceof DispatchError,parse:value=>{
      try{
        const raw=object(value,["version","hostId","placements"]);
        if(raw.version!==1||raw.hostId!==options.store.options.hostId||!Array.isArray(raw.placements)||raw.placements.length>10000)throw new DispatchError("Invalid remote worker registry");
        const ids=new Set<string>();
        for(const value of raw.placements){const p=object(value,["id","ownerHostId","identity","selection"]) as unknown as Placement;validateTaskIdentity(p.identity);selection(p.selection);
          if(p.ownerHostId!==raw.hostId||p.identity.role!=="worker"||p.identity.hostId===raw.hostId||p.id!==replicaId(p.ownerHostId,p.identity)||ids.has(p.id))throw new DispatchError("Invalid remote worker placement");ids.add(p.id);
        }
        return raw as unknown as Registry;
      }catch(error){if(error instanceof DispatchError)throw error;throw new DispatchError("Invalid remote worker registry",{cause:error});}
    }};
  }
  private async placements(){return (await readJsonStore(this.spec,this.file)).value.placements;}
  private validateTransfer(value:unknown,expected:Placement):WorkerTransfer{
    const raw=object(value,["id","ownerHostId","identity","selection","attempt","pending"]) as unknown as WorkerTransfer;
    validateTaskIdentity(raw.identity);validateTaskAttempt(raw.attempt);selection(raw.selection);
    if(raw.id!==expected.id||raw.ownerHostId!==expected.ownerHostId||!sameTaskIdentity(raw.identity,expected.identity)||!sameSelection(raw.selection,expected.selection)||raw.attempt.id!==expected.identity.attemptId||raw.attempt.generation!==expected.identity.generation||!Array.isArray(raw.pending)||raw.pending.length>100000)throw new DispatchError("Remote worker transfer identity changed");
    for(const value of raw.pending){const operation=validateRemoteTaskOperation(value);if(operation.ownerHostId!==expected.ownerHostId||!sameTaskIdentity(operation.source,expected.identity))throw new DispatchError("Remote worker operation scope changed");}
    return raw;
  }
  async prepare(task:Task,identity:TaskIdentity,selected:RegisteredTaskStart):Promise<void>{
    validateTaskSnapshot({schemaVersion:2,hostId:this.options.store.options.hostId,tasks:[task],outbox:[]});selection(selected);
    const authorized=await this.options.store.bind(identity);
    if(!sameTaskIdentity(authorized,identity)||identity.role!=="worker"||identity.hostId===task.ownerHostId||identity.taskId!==task.id)throw new DispatchError("Invalid remote worker selection");
    const placement:Placement={id:replicaId(task.ownerHostId,identity),ownerHostId:task.ownerHostId,identity:structuredClone(identity),selection:structuredClone(selected)};
    const prior=(await this.placements()).find(item=>item.id===placement.id);
    if(prior&&!sameSelection(prior.selection,selected))throw new DispatchError("Selected checkout differs from the prepared worker");
    const response=await this.options.client(identity.hostId).request("/workers/prepare","POST",{task,identity,selection:selected});this.validateTransfer(response,placement);
    await updateJsonStore(this.spec,this.file,registry=>{
      const existing=registry.placements.find(item=>item.id===placement.id);
      if(existing&&!sameSelection(existing.selection,selected))throw new DispatchError("Concurrent worker selection changed");
      if(!existing)registry.placements.push(placement);return registry;
    });
  }
  async admit(identity:TaskIdentity):Promise<unknown>{
    validateTaskIdentity(identity);const placement=(await this.placements()).find(item=>sameTaskIdentity(item.identity,identity));
    if(!placement)throw new DispatchError("Worker has not been prepared");if(this.admitting.has(placement.id))throw new DispatchError("Worker admission already in progress");this.admitting.add(placement.id);
    try{
      await this.synchronization;
      const commandId=randomUUID();await this.options.store.beginDelivery(identity,commandId);
      try{
        const result=await this.options.client(identity.hostId).request(`/workers/${placement.id}/admit`,"POST",{task:await this.options.store.inspect(identity.taskId),commandId});
        // Only the durable worker observation settles admission, not an arbitrary HTTP success.
        await this.synchronizeOne(placement);
        if((await this.options.store.inspect(identity.taskId)).participants.find(member=>member.id===identity.participantId)?.attempt.delivery!=="delivered")throw new DispatchError("Worker admission was not confirmed; reconcile without replay");
        return result;
      }catch(error){
        const current=(await this.options.store.inspect(identity.taskId)).participants.find(member=>member.id===identity.participantId)!.attempt;
        if(current.delivery==="pending")await this.options.store.resolveDelivery(identity,commandId,"unknown");throw error;
      }
    }finally{this.admitting.delete(placement.id);}
  }
  private async synchronizeOne(placement:Placement):Promise<void>{
    const {identity}=placement,client=this.options.client(identity.hostId);
    const transfer=this.validateTransfer(await client.request(`/workers/${placement.id}`,"GET",undefined,10000),placement);
    const task=await this.options.store.inspect(identity.taskId),current=task.participants.find(member=>member.id===identity.participantId)?.attempt;
    if(current?.id===identity.attemptId&&current.generation===identity.generation)await this.options.store.observeRemoteAttempt(identity,transfer.attempt);
    const acknowledged:string[]=[];
    for(const operation of transfer.pending){await this.options.store.ingestRemoteOperation(operation,identity.hostId);acknowledged.push(operation.id);}
    await client.request(`/workers/${placement.id}/sync`,"POST",{task:await this.options.store.inspect(identity.taskId),acknowledged},10000);
  }
  /** Repeat task-data receipts only. No path from this loop to prepare/admit or process creation. */
  async synchronize():Promise<void>{
    if(this.synchronization)return this.synchronization;
    this.synchronization=(async()=>{
      for(const placement of await this.placements())try{if(!this.admitting.has(placement.id))await this.synchronizeOne(placement);}catch{
        const task=await this.options.store.inspect(placement.identity.taskId),current=task.participants.find(member=>member.id===placement.identity.participantId)?.attempt;
        if(current?.id===placement.identity.attemptId&&["running","idle"].includes(current.execution))await this.options.store.observeExecution(placement.identity,"lost");
      }
    })().finally(()=>{this.synchronization=undefined;});return this.synchronization;
  }
}
