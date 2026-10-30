// @vitest-environment node
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {TaskStore} from "./task-store";
import {WorkerReplicas} from "./worker-replicas";
import {WorkerExecutor} from "./worker-executor";
import type {HostTerminalService} from "./gateway";
const exec=promisify(execFile),directories:string[]=[];
vi.setConfig({testTimeout:15000});
afterEach(async()=>{await Promise.all(directories.splice(0).map(directory=>rm(directory,{recursive:true,force:true})));});
async function fixture(){
  const directory=await mkdtemp(path.join(os.tmpdir(),"mcw-worker-launch-"));directories.push(directory);
  const repository=path.join(directory,"repo");await mkdir(repository);
  const git=(...args:string[])=>exec("git",["-C",repository,...args]);
  await git("init");await writeFile(path.join(repository,"source.txt"),"base\n");await git("add",".");await git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-m","base");
  const head=(await git("rev-parse","HEAD")).stdout.trim();
  const owner=new TaskStore({directory:path.join(directory,"owner"),hostId:"owner"}),replicas=new WorkerReplicas({directory:path.join(directory,"worker"),hostId:"remote"});
  const task=await owner.createTask({title:"Remote execution",brief:"Keep evidence",lead:{hostId:"owner",provider:"claude",profileId:"lead"},workers:[{hostId:"remote",provider:"codex",profileId:"worker"}]});
  const worker=await owner.bind({taskId:task.id,participantId:task.participants[1].id,attemptId:task.participants[1].attempt.id,generation:1});
  const profile={participantId:worker.participantId,executable:process.execPath,profile:{id:"worker",name:"Selected",agentId:"codex" as const,model:null,effort:null}};
  const catalog={prepareWorker:vi.fn(async()=>({repositoryPath:repository,expectedHead:head,projectId:"remote-repo",profiles:[profile]}))};
  const sessions:Record<string,unknown>[]=[],create=vi.fn(async(input:Record<string,unknown>)=>{const session={...input,id:input.sessionId,delivery:"delivered",connected:true,status:"working"};sessions.push(session);return session;});
  const mcpClientPath=path.join(directory,"mcp-client.js");await writeFile(mcpClientPath,"// fixture");
  const executor=new WorkerExecutor({directory:replicas.options.directory,replicas,catalog,terminals:{create,list:async()=>sessions} as unknown as HostTerminalService,mcpClientPath,issueTaskToken:async ref=>{await replicas.bind(ref);return "x".repeat(43);},gatewayUrl:()=>"http://127.0.0.1:12345"});
  const selection={repositoryId:"remote-repo",expectedHead:head,expectedPath:repository};
  return {directory,owner,replicas,task,worker,executor,selection,repository,git,create,sessions,catalog};
}
it("prepares a foreign worker worktree before admission and launches its selected local profile exactly once",async()=>{
  const {owner,replicas,task,worker,executor,selection,repository,git,create}=await fixture();
  const prepared=await executor.prepare(task,worker,selection);expect(create).not.toHaveBeenCalled();
  await expect(executor.admit(prepared.id,"command",task)).rejects.toThrow();
  await owner.beginDelivery(worker,"command");await executor.admit(prepared.id,"command",await owner.inspect(task.id));
  expect(create).toHaveBeenCalledTimes(1);expect(create.mock.calls[0][0].cwd).not.toBe(repository);
  expect(create.mock.calls[0][0].env).toMatchObject({MCW_TASK_OWNER_HOST_ID:"owner",MCW_TASK_ROLE:"worker"});
  expect((await replicas.get(prepared.id)).attempt).toMatchObject({delivery:"delivered",execution:"running",commandId:"command"});
  expect((await git("rev-parse","HEAD")).stdout.trim()).toBe(selection.expectedHead);expect((await git("status","--porcelain")).stdout.trim()).toBe("");
  await expect(executor.admit(prepared.id,"command",await owner.inspect(task.id))).rejects.toThrow();expect(create).toHaveBeenCalledTimes(1);
});
it("retains uncertain delivery after a lost broker reply and reconciles observation without re-execution",async()=>{
  const {owner,replicas,task,worker,executor,selection,create,sessions}=await fixture();
  const prepared=await executor.prepare(task,worker,selection);await owner.beginDelivery(worker,"command");
  create.mockImplementationOnce(async input=>{sessions.push({...input,id:input.sessionId,delivery:"delivered",connected:true,status:"idle"});throw new Error("reply lost");});
  await expect(executor.admit(prepared.id,"command",await owner.inspect(task.id))).rejects.toThrow("reply lost");
  expect((await replicas.get(prepared.id)).attempt.delivery).toBe("unknown");await replicas.recover();
  await expect(executor.admit(prepared.id,"command",await owner.inspect(task.id))).rejects.toThrow();expect(create).toHaveBeenCalledTimes(1);
  await executor.reconcile();expect((await replicas.get(prepared.id)).attempt).toMatchObject({delivery:"delivered",execution:"idle",submittedResultId:null});
});
it("records a proven pre-dispatch rejection when the checked checkout changes",async()=>{
  const {owner,replicas,task,worker,executor,selection,catalog,create}=await fixture();
  const prepared=await executor.prepare(task,worker,selection);await owner.beginDelivery(worker,"command");
  catalog.prepareWorker.mockRejectedValueOnce(new Error("checkout changed"));
  await expect(executor.admit(prepared.id,"command",await owner.inspect(task.id))).rejects.toThrow("checkout changed");
  expect((await replicas.get(prepared.id)).attempt).toMatchObject({delivery:"rejected",commandId:"command"});expect(create).not.toHaveBeenCalled();
});
