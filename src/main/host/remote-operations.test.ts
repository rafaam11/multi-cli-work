// @vitest-environment node
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it} from "vitest";
import {TaskStore} from "./task-store";
import type {TaskIdentity} from "../../shared/host-types";
const directories:string[]=[];
afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true})));});
async function fixture(){
  const directory=await mkdtemp(path.join(os.tmpdir(),"mcw-remote-ops-"));directories.push(directory);
  const owner=new TaskStore({directory,hostId:"owner"});
  const task=await owner.createTask({title:"Distributed",brief:"Retain remote results",lead:{hostId:"owner",provider:"claude",profileId:"lead"},workers:[{hostId:"worker-pc",provider:"codex",profileId:"worker"}]});
  const identity=(index:number):TaskIdentity=>({taskId:task.id,participantId:task.participants[index].id,attemptId:task.participants[index].attempt.id,generation:1,role:task.participants[index].role,hostId:task.participants[index].hostId});
  return {owner,task,lead:identity(0),worker:identity(1)};
}
it("commits remote messages and questions once across lost replies and owner restart",async()=>{
  const {owner,task,worker,lead}=await fixture();
  const operation={id:"message-1",ownerHostId:"owner",source:worker,action:{kind:"message" as const,to:lead.participantId,text:"Ready on remote PC"}};
  const first=await owner.ingestRemoteOperation(operation,"worker-pc");
  const reopened=new TaskStore(owner.options);
  expect(await reopened.ingestRemoteOperation(operation,"worker-pc")).toEqual(first);
  expect((await reopened.receive(lead,0)).events.map(event=>event.text)).toEqual(["Ready on remote PC"]);
  await expect(reopened.ingestRemoteOperation({...operation,action:{...operation.action,text:"Conflicting replacement"}},"worker-pc")).rejects.toThrow(/conflict/i);
  await expect(reopened.ingestRemoteOperation(operation,"wrong-host")).rejects.toThrow();
  const question={...operation,id:"question-1",action:{kind:"approval" as const,text:"Review this change?"}};
  await reopened.ingestRemoteOperation(question,"worker-pc");await reopened.ingestRemoteOperation(question,"worker-pc");
  expect((await reopened.inspect(task.id)).questions).toMatchObject([{id:question.id,kind:"approval",acknowledged:false,answer:null,source:worker}]);
  expect((await reopened.inspect(task.id)).participants[1].attempt.execution).toBe("not_started");
});
it("acknowledges an already committed old attempt without letting it append into a new generation",async()=>{
  const {owner,task,worker,lead}=await fixture();
  const operation={id:"old-message",ownerHostId:"owner",source:worker,action:{kind:"message" as const,to:null,text:"Already sent"}};
  const first=await owner.ingestRemoteOperation(operation,"worker-pc");
  await owner.observeExecution(worker,"exited");await owner.restartAttempt(lead,worker.participantId);
  expect(await owner.ingestRemoteOperation(operation,"worker-pc")).toEqual(first);
  await expect(owner.ingestRemoteOperation({...operation,id:"stale-new-message"},"worker-pc")).rejects.toThrow(/stale|Unauthorized/);
  const next=(await owner.inspect(task.id)).participants[1].attempt;
  expect((await owner.receive({...worker,attemptId:next.id,generation:next.generation},0)).events).toHaveLength(0);
  expect((await owner.inspect(task.id)).events).toHaveLength(1);
});
it("deduplicates results and rejects authority, shape and payload conflicts",async()=>{
  const {owner,task,worker,lead}=await fixture();
  const result={summary:"Remote result",changes:["owned worktree"],verification:["checked"],artifacts:[],issues:[]};
  const operation={id:"result-1",ownerHostId:"owner",source:worker,action:{kind:"result" as const,result}};
  const first=await owner.ingestRemoteOperation(operation,"worker-pc");
  await owner.observeExecution(worker,"exited");await owner.restartAttempt(lead,worker.participantId);
  expect(await owner.ingestRemoteOperation(operation,"worker-pc")).toEqual(first);
  expect((await owner.inspect(task.id)).results).toMatchObject([{summary:"Remote result",integration:"unintegrated",review:"pending"}]);
  await expect(owner.ingestRemoteOperation({...operation,action:{kind:"result",result:{...result,summary:"replaced"}}},"worker-pc")).rejects.toThrow(/conflict/i);
  await expect(owner.ingestRemoteOperation({...operation,ownerHostId:"another-owner"},"worker-pc")).rejects.toThrow();
  await expect(owner.ingestRemoteOperation({...operation,source:{...worker,role:"lead"}},"worker-pc")).rejects.toThrow();
  await expect(owner.ingestRemoteOperation({...operation,action:{...operation.action,command:"never"}},"worker-pc")).rejects.toThrow();
});
