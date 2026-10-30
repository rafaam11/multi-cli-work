// @vitest-environment node
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it} from "vitest";
import {TaskStore} from "./task-store";
import {WorkerReplicas} from "./worker-replicas";
import {TaskMcpServer} from "../mcw-task-mcp";
import type {TaskIdentity} from "../../shared/host-types";
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true})));});
async function fixture(){
  const directory=await mkdtemp(path.join(os.tmpdir(),"mcw-replicas-"));directories.push(directory);
  const owner=new TaskStore({directory:path.join(directory,"owner"),hostId:"owner"});
  const task=await owner.createTask({title:"Distributed task",brief:"Keep results",lead:{hostId:"owner",provider:"claude",profileId:"lead"},workers:[{hostId:"remote",provider:"codex",profileId:"worker"}]});
  const identity=(index:number):TaskIdentity=>({taskId:task.id,participantId:task.participants[index].id,attemptId:task.participants[index].attempt.id,generation:1,hostId:task.participants[index].hostId,role:task.participants[index].role});
  const worker=identity(1),lead=identity(0),options={directory:path.join(directory,"remote"),hostId:"remote"};
  const replicas=new WorkerReplicas(options),selection={repositoryId:"remote-repo",expectedPath:path.join(directory,"repo"),expectedHead:"a".repeat(40)};
  const registration=await replicas.register(task,worker,selection);
  return {owner,task,lead,worker,replicas,options,registration,selection};
}
const result={summary:"Saved remotely",changes:["owned branch"],verification:["local check"],artifacts:["result.txt"],issues:[]};
it("keeps offline messages, questions and results across restart, and clears only owner-proven receipts",async()=>{
  const {owner,task,lead,worker,replicas,options,registration}=await fixture();
  await replicas.message(worker,lead.participantId,"Remote ready");await replicas.ask(worker,"approval","Review before integration");await replicas.submitResult(worker,result);
  const reopened=new WorkerReplicas(options),pending=await reopened.pending(registration.id);
  expect(pending).toHaveLength(3);expect((await owner.inspect(task.id)).events).toHaveLength(0);
  await expect(reopened.synchronize(registration.id,task,pending.map(operation=>operation.id))).rejects.toThrow(/receipt|committed/i);
  for(const operation of pending)await owner.ingestRemoteOperation(operation,"remote");
  // Owner committed, but the acknowledgement was lost. Data may be resent;
  // this path never admits a provider command or changes execution status.
  expect(await reopened.pending(registration.id)).toHaveLength(3);
  for(const operation of pending)await owner.ingestRemoteOperation(operation,"remote");
  const canonical=await owner.inspect(task.id);expect(canonical.events).toHaveLength(3);expect(canonical.results).toHaveLength(1);
  await reopened.synchronize(registration.id,canonical,pending.map(operation=>operation.id));
  expect(await reopened.pending(registration.id)).toEqual([]);
  expect((await reopened.receive(worker,0)).events).toHaveLength(3);
  await expect(reopened.submitResult(worker,{...result,summary:"Conflicting result"})).rejects.toThrow(/conflict/i);
  expect((await reopened.get(registration.id)).attempt.execution).toBe("not_started");
});
it("distinguishes command delivery from data synchronization and never re-admits uncertain execution",async()=>{
  const {worker,replicas,options,registration,owner,task}=await fixture();
  await replicas.beginDelivery(worker,"launch-command");
  const reopened=new WorkerReplicas(options);await reopened.recover();
  expect((await reopened.get(registration.id)).attempt.delivery).toBe("unknown");
  await expect(reopened.beginDelivery(worker,"another-command")).rejects.toThrow();
  await reopened.synchronize(registration.id,await owner.inspect(task.id),[]);
  expect((await reopened.get(registration.id)).attempt.delivery).toBe("unknown");
  await reopened.resolveDelivery(worker,"launch-command","delivered");await reopened.observeExecution(worker,"idle");
  expect((await reopened.get(registration.id)).attempt).toMatchObject({execution:"idle",submittedResultId:null});
});
it("rejects changed owner/selection and stale snapshots, and revokes MCP authority when the owner supersedes an attempt",async()=>{
  const {owner,task,lead,worker,replicas,registration,selection}=await fixture();
  await expect(replicas.register(task,worker,{...selection,expectedHead:"b".repeat(40)})).rejects.toThrow(/conflict/i);
  await expect(replicas.register(task,{...worker,role:"lead"},selection)).rejects.toThrow();
  await owner.messageAsUser(task.id,"New instruction");await replicas.synchronize(registration.id,await owner.inspect(task.id),[]);
  await expect(replicas.synchronize(registration.id,task,[])).rejects.toThrow(/stale|regress/i);
  await owner.observeExecution(worker,"exited");await owner.restartAttempt(lead,worker.participantId);
  await replicas.synchronize(registration.id,await owner.inspect(task.id),[]);
  await expect(replicas.message(worker,null,"stale write")).rejects.toThrow(/stale|Unauthorized/);
  await expect(replicas.receive(worker,0)).rejects.toThrow(/stale|Unauthorized/);
});
it("serves task-only MCP locally while the owner is offline without granting lead authority",async()=>{
  const {replicas,worker,registration}=await fixture(),mcp=new TaskMcpServer(replicas,worker);
  expect(await mcp.dispatch("task_inspect")).toMatchObject({ownerHostId:"owner",localAttempt:{delivery:"none"},remote:{pendingOperations:0}});
  await mcp.dispatch("task_message",{text:"Saved before disconnect"});
  await mcp.dispatch("task_submit",result);
  expect(await replicas.pending(registration.id)).toHaveLength(2);
  await expect(mcp.dispatch("task_assign",{provider:"claude",profileId:"lead"})).rejects.toThrow(/owner lead/);
  await expect(mcp.dispatch("task_cancel")).rejects.toThrow(/owner lead/);
  await expect(mcp.dispatch("task_message",{text:"override",taskId:"other"})).rejects.toThrow();
});
