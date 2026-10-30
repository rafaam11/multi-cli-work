// @vitest-environment node
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach,expect,it} from "vitest";
import {TaskStore} from "../host/task-store";
import {recoveryWorkInventory,recoveryTasksReady} from "./work-inventory";
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function task(){
  const directory=await mkdtemp(path.join(tmpdir(),"mcw-recovery-work-"));roots.push(directory);
  return new TaskStore({directory,hostId:"owner"}).createTask({title:"fixture",brief:"fixture",lead:{hostId:"owner",provider:"claude",profileId:"lead"},workers:[{hostId:"worker",provider:"codex",profileId:"worker"}]});
}
it("keeps idle, lost and uncertain dispatches in the remote recovery scope",async()=>{
  const record=await task();record.participants[1].attempt={...record.participants[1].attempt,execution:"idle",delivery:"delivered",commandId:"command"};
  let result=recoveryWorkInventory("owner",[record],[]);
  expect(result.related).toEqual([{hostId:"worker",taskIds:[record.id]}]);expect(result.unsettledTaskIds).toEqual([record.id]);
  record.participants[1].attempt.execution="lost";record.participants[1].attempt.delivery="unknown";
  result=recoveryWorkInventory("owner",[record],[]);expect(result.unsettledTaskIds).toEqual([record.id]);
});
it("does not require an old disconnected PC for already confirmed immutable exits",async()=>{
  const record=await task();for(const participant of record.participants)participant.attempt={...participant.attempt,execution:"exited",delivery:"delivered",commandId:"done"};
  expect(recoveryWorkInventory("owner",[record],[])).toEqual({related:[],unsettledTaskIds:[],undeliveredOperations:0});
});
it("retains the owner dependency for prepared replicas and unacknowledged results",async()=>{
  const record=await task();const worker=record.participants[1];
  const replica={ownerHostId:"owner",task:record,identity:{taskId:record.id,hostId:"worker"},attempt:worker.attempt,pendingOperations:0};
  expect(recoveryWorkInventory("worker",[],[replica]).related).toEqual([{hostId:"owner",taskIds:[record.id]}]);
  replica.attempt={...worker.attempt,execution:"exited",delivery:"delivered",commandId:"done"};replica.pendingOperations=1;
  const result=recoveryWorkInventory("worker",[],[replica]);expect(result.undeliveredOperations).toBe(1);expect(result.related).toEqual([{hostId:"owner",taskIds:[record.id]}]);
});
it("checks only related terminal work and refuses missing task/process observations",async()=>{
  const record=await task(),lead=record.participants[0];lead.attempt={...lead.attempt,execution:"exited",delivery:"delivered",commandId:"done"};
  const ended={id:lead.attempt.id,status:"exited",connected:true,delivery:"delivered"};
  expect(recoveryTasksReady("owner",[record.id],[record],[],[ended,{id:"unrelated",status:"working",connected:true,delivery:"delivered"}]).ready).toBe(true);
  expect(recoveryTasksReady("owner",[record.id],[record],[],[]).ready).toBe(false);
  expect(recoveryTasksReady("owner",["missing"],[record],[],[ended]).missingTaskIds).toEqual(["missing"]);
  expect(recoveryTasksReady("owner",[record.id],[record],[],[{...ended,connected:false}]).ready).toBe(false);
});
