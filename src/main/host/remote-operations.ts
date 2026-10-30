import type {RemoteTaskOperation} from "../../shared/remote-task-types";
import type {TaskIdentity} from "../../shared/host-types";
import {createHash} from "node:crypto";
import {validateTaskId,validateTaskIdentity,validateTaskResult,validateTaskText} from "./task-validation";
function fields(value:unknown,keys:string[]):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join(",")!==keys.sort().join(","))throw new Error("Invalid remote task operation");
  return value as Record<string,unknown>;
}
export function sameTaskIdentity(left:TaskIdentity|undefined,right:TaskIdentity):boolean{
  return !!left&&(["taskId","participantId","attemptId","generation","hostId","role"] as const).every(key=>left[key]===right[key]);
}
export function taskResultKey(identity:TaskIdentity):string{return createHash("sha256").update(JSON.stringify([identity.taskId,identity.participantId,identity.attemptId,identity.generation])).digest("hex");}
export function validateRemoteTaskOperation(value:unknown):RemoteTaskOperation{
  const operation=fields(value,["id","ownerHostId","source","action"]);
  validateTaskId(operation.id);validateTaskId(operation.ownerHostId);validateTaskIdentity(operation.source);
  if(!/^[\w-]{1,200}$/.test(operation.id))throw new Error("Invalid remote operation ID");
  const raw=operation.action as Record<string,unknown>;
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("Invalid remote task action");
  if(raw.kind==="message"){
    fields(raw,["kind","to","text"]);validateTaskText(raw.text);if(raw.to!==null)validateTaskId(raw.to);
  }else if(raw.kind==="question"||raw.kind==="approval"){
    fields(raw,["kind","text"]);validateTaskText(raw.text);
  }else if(raw.kind==="result"){
    fields(raw,["kind","result"]);validateTaskResult(raw.result);
  }else throw new Error("Remote worker operation is not permitted");
  return value as RemoteTaskOperation;
}
