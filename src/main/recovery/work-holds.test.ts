// @vitest-environment node
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach,expect,it} from "vitest";
import {RecoveryWorkHolds} from "./work-holds";
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){const directory=await mkdtemp(path.join(tmpdir(),"mcw-recovery-holds-"));roots.push(directory);return {directory,store:new RecoveryWorkHolds(directory)};}
it("persists a scoped hold across host restarts without blocking unrelated tasks",async()=>{
  const {directory,store}=await fixture();const input={id:"rollback-1",requesterHostId:"pc-a",taskIds:["task-a"]};
  await store.hold(input);const restored=new RecoveryWorkHolds(directory);
  expect(await restored.blocks("task-a")).toBe(true);expect(await restored.blocks("task-b")).toBe(false);expect(await restored.blocksHost()).toBe(false);
  expect(await restored.hold(input)).toEqual(await store.get(input.id));
});
it("releases only the matching request and never reactivates a released operation",async()=>{
  const {store}=await fixture();const input={id:"rollback-1",requesterHostId:"pc-a",taskIds:null};
  await store.hold(input);await store.hold({id:"rollback-2",requesterHostId:"pc-a",taskIds:null});
  await expect(store.release(input.id,"other")).rejects.toThrow(/requester/i);
  await store.release(input.id,input.requesterHostId);expect(await store.blocksHost()).toBe(true);
  await expect(store.hold(input)).rejects.toThrow(/released/i);
  await store.release("rollback-2","pc-a");expect(await store.blocksHost()).toBe(false);
});
it("refuses changed scopes, duplicate tasks and malformed requests",async()=>{
  const {store}=await fixture();await store.hold({id:"rollback-1",requesterHostId:"pc-a",taskIds:["a"]});
  await expect(store.hold({id:"rollback-1",requesterHostId:"pc-a",taskIds:["b"]})).rejects.toThrow(/scope/i);
  await expect(store.hold({id:"bad",requesterHostId:"pc-a",taskIds:["a","a"]})).rejects.toThrow();
  await expect(store.hold({id:"bad",requesterHostId:"pc-a",taskIds:[]})).rejects.toThrow();
});
