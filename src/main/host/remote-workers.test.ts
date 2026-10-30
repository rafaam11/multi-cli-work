// @vitest-environment node
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {TaskStore} from "./task-store";
import {WorkerReplicas} from "./worker-replicas";
import {RemoteWorkers} from "./remote-workers";
import type {WorkerTransfer} from "../../shared/remote-task-types";
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true})));});
async function fixture(){
  const directory=await mkdtemp(path.join(os.tmpdir(),"mcw-dispatch-"));directories.push(directory);
  const store=new TaskStore({directory,hostId:"owner"}),replicas=new WorkerReplicas({directory:path.join(directory,"worker"),hostId:"remote"});
  const task=await store.createTask({title:"Distributed",brief:"Collect",lead:{hostId:"owner",provider:"claude",profileId:"lead"},workers:[{hostId:"remote",provider:"codex",profileId:"worker"}]});
  const member=task.participants[1],identity=await store.bind({taskId:task.id,participantId:member.id,attemptId:member.attempt.id,generation:1});
  const selection={repositoryId:"repo",expectedPath:directory,expectedHead:"a".repeat(40)};
  let online=true,lostAdmission=false,lostAck=false,launches=0;
  const transfer=async(id:string):Promise<WorkerTransfer>=>{const r=await replicas.get(id);return {id:r.id,ownerHostId:r.ownerHostId,identity:r.identity,selection:r.selection,attempt:r.attempt,pending:await replicas.pending(id)};};
  const request=vi.fn(async(route:string,_method?:string,input?:any)=>{
    if(!online)throw new Error("offline");
    if(route==="/workers/prepare")return transfer((await replicas.register(input.task,input.identity,input.selection)).id);
    const [,id,action]=/^\/workers\/([^/]+)(?:\/(sync|admit))?$/.exec(route)!;
    if(action==="admit"){
      await replicas.synchronize(id,input.task,[]);await replicas.beginDelivery(identity,input.commandId);launches++;
      await replicas.resolveDelivery(identity,input.commandId,"delivered");await replicas.observeExecution(identity,"running");
      if(lostAdmission)throw new Error("admission reply lost");return {};
    }
    if(action==="sync"){if(lostAck)throw new Error("ack lost");await replicas.synchronize(id,input.task,input.acknowledged);return {};}
    return transfer(id);
  });
  const options={directory,store,client:(hostId:string)=>{expect(hostId).toBe("remote");return {request:request as any};}};
  const remote=new RemoteWorkers(options);
  return {store,replicas,task,member,identity,selection,request,remote,options,launches:()=>launches,setOnline:(value:boolean)=>online=value,loseAdmission:()=>lostAdmission=true,loseAck:(value:boolean)=>lostAck=value};
}
it("reconciles a lost admission reply after restart without repeating execution and preserves actual observation time",async()=>{
  const f=await fixture();await f.remote.prepare(f.task,f.identity,f.selection);f.loseAdmission();
  await expect(f.remote.admit(f.identity)).rejects.toThrow();
  expect((await f.store.inspect(f.task.id)).participants[1].attempt.delivery).toBe("unknown");
  await f.store.recover();const resumed=new RemoteWorkers(f.options);await resumed.synchronize();
  const observed=(await f.store.inspect(f.task.id)).participants[1].attempt;
  expect(observed.delivery).toBe("delivered");expect(observed.execution).toBe("running");
  expect(observed.observedAt).toBe((await f.replicas.list())[0].attempt.observedAt);
  await expect(resumed.admit(f.identity)).rejects.toThrow();expect(f.launches()).toBe(1);
  f.setOnline(false);await resumed.synchronize();
  expect((await f.store.inspect(f.task.id)).participants[1].attempt).toMatchObject({execution:"lost",observedAt:observed.observedAt});
});
it("collects offline messages and results once despite a lost acknowledgement and delivers owner messages on reconnect",async()=>{
  const f=await fixture();await f.remote.prepare(f.task,f.identity,f.selection);await f.remote.admit(f.identity);
  f.setOnline(false);await f.replicas.message(f.identity,null,"offline evidence");
  await f.replicas.submitResult(f.identity,{summary:"done",changes:["worktree only"],verification:["test"],artifacts:[],issues:[]});
  await f.store.messageAsUser(f.task.id,"next question");await f.remote.synchronize();
  expect((await f.store.inspect(f.task.id)).results).toHaveLength(0);
  f.setOnline(true);f.loseAck(true);await f.remote.synchronize();f.loseAck(false);await f.remote.synchronize();await f.remote.synchronize();
  const task=await f.store.inspect(f.task.id);
  expect(task.results).toHaveLength(1);expect(task.results[0]).toMatchObject({integration:"unintegrated",review:"pending"});
  expect(task.events.filter(event=>event.text==="offline evidence")).toHaveLength(1);
  expect((await f.replicas.list())[0].operations.every(item=>item.acknowledged)).toBe(true);
  expect((await f.replicas.receive(f.identity)).events.some(event=>event.text==="next question")).toBe(true);
  expect(f.launches()).toBe(1);
});
it("rejects a different checked checkout and forged remote identity without admitting a command",async()=>{
  const f=await fixture();await f.remote.prepare(f.task,f.identity,f.selection);
  await expect(f.remote.prepare(f.task,f.identity,{...f.selection,expectedHead:"b".repeat(40)})).rejects.toThrow();
  f.request.mockResolvedValueOnce({...((await f.replicas.list())[0]),identity:{...f.identity,hostId:"other"},pending:[]});
  await f.remote.synchronize();expect(f.launches()).toBe(0);
  expect((await f.store.inspect(f.task.id)).participants[1].attempt.delivery).toBe("none");
});
