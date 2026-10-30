import path from "node:path";
import {readJsonStore,updateJsonStore,type JsonStoreSpec} from "../storage/json-store";

export interface RecoveryHoldInput {id:string;requesterHostId:string;/** null holds all new admissions on this PC. */taskIds:string[]|null}
export interface RecoveryHold extends RecoveryHoldInput {createdAt:number;releasedAt:number|null}
interface HoldStore {version:1;holds:RecoveryHold[]}
class HoldError extends Error {}
const id=(value:unknown)=>typeof value==="string"&&/^[\w-]{1,200}$/.test(value);
export function validateRecoveryHold(value:unknown):asserts value is RecoveryHoldInput{
  const input=value as RecoveryHoldInput;
  if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).sort().join(",")!=="id,requesterHostId,taskIds"||!id(input.id)||!id(input.requesterHostId)||(input.taskIds!==null&&(!Array.isArray(input.taskIds)||!input.taskIds.length||input.taskIds.length>10000||input.taskIds.some(task=>!id(task))||new Set(input.taskIds).size!==input.taskIds.length)))throw new HoldError("Invalid recovery hold");
}
const spec:JsonStoreSpec<HoldStore>={label:"recovery work holds",displayName:"복귀 중 작업 접수 제한",empty:()=>({version:1,holds:[]}),parse:value=>{
  const store=value as HoldStore;if(!store||store.version!==1||!Array.isArray(store.holds)||store.holds.length>10000||Object.keys(store).sort().join(",")!=="holds,version")throw new HoldError("Invalid recovery holds");
  const ids=new Set<string>();
  for(const hold of store.holds){
    if(!hold||Object.keys(hold).sort().join(",")!=="createdAt,id,releasedAt,requesterHostId,taskIds")throw new HoldError("Invalid recovery hold record");
    validateRecoveryHold({id:hold.id,requesterHostId:hold.requesterHostId,taskIds:hold.taskIds});
    if(ids.has(hold.id)||!Number.isSafeInteger(hold.createdAt)||hold.createdAt<0||(hold.releasedAt!==null&&(!Number.isSafeInteger(hold.releasedAt)||hold.releasedAt<hold.createdAt)))throw new HoldError("Invalid recovery hold timestamp");ids.add(hold.id);
  }
  return store;
},error:(message,options)=>new HoldError(message,options),isContentError:error=>error instanceof HoldError};

/** Durable admission holds do not cancel, stop or restart any process. Releasing
 * one rollback cannot release another rollback's hold or replay old work. */
export class RecoveryWorkHolds {
  private file:string;
  constructor(directory:string){this.file=path.join(directory,"recovery-work-holds.json");}
  private async read(){const result=await readJsonStore(spec,this.file);if(!result.writable)throw new HoldError(result.warning??"Recovery holds require reconciliation");return result.value.holds;}
  async list():Promise<RecoveryHold[]>{return structuredClone(await this.read());}
  async get(operationId:string):Promise<RecoveryHold|null>{if(!id(operationId))throw new HoldError("Invalid recovery operation");return structuredClone((await this.read()).find(hold=>hold.id===operationId)??null);}
  async blocksHost():Promise<boolean>{return (await this.read()).some(hold=>hold.releasedAt===null&&hold.taskIds===null);}
  async blocks(taskId:string):Promise<boolean>{if(!id(taskId))throw new HoldError("Invalid task ID");return (await this.read()).some(hold=>hold.releasedAt===null&&(hold.taskIds===null||hold.taskIds.includes(taskId)));}
  async hold(input:RecoveryHoldInput):Promise<RecoveryHold>{
    validateRecoveryHold(input);const selected={...input,taskIds:input.taskIds?[...input.taskIds].sort():null};let result!:RecoveryHold;
    await updateJsonStore(spec,this.file,store=>{
      const current=store.holds.find(hold=>hold.id===selected.id);
      if(current){if(current.requesterHostId!==selected.requesterHostId||JSON.stringify(current.taskIds)!==JSON.stringify(selected.taskIds))throw new HoldError("Recovery hold scope changed");if(current.releasedAt!==null)throw new HoldError("Recovery hold was already released");result=current;return store;}
      result={...selected,createdAt:Date.now(),releasedAt:null};store.holds.push(result);return store;
    });return structuredClone(result);
  }
  async release(operationId:string,requesterHostId:string):Promise<void>{
    if(!id(operationId)||!id(requesterHostId))throw new HoldError("Invalid recovery release");
    await updateJsonStore(spec,this.file,store=>{const hold=store.holds.find(item=>item.id===operationId);if(!hold)throw new HoldError("Unknown recovery operation");if(hold.requesterHostId!==requesterHostId)throw new HoldError("Recovery hold requester differs");hold.releasedAt??=Math.max(Date.now(),hold.createdAt);return store;});
  }
}
