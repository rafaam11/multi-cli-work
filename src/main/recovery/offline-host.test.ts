// @vitest-environment node
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import {afterEach,expect,it} from 'vitest';
import {openOfflineRecoveryHost} from './offline-host';
import {TaskStore} from '../host/task-store';
import {RecoveryWorkSession} from './work-session';
import type {ProcessIdentity} from '../herdr/process-observation';

const roots:string[]=[],close:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const release of close.splice(0).reverse())await release();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const old:ProcessIdentity={pid:41,parentPid:1,startId:'windows:10',name:'node',executable:null};
async function fixture(){const directory=await mkdtemp(path.join(tmpdir(),'mcw-offline-recovery-'));roots.push(directory);return directory;}
async function connect(directory:string,inventory:ProcessIdentity[]=[]){const client=await openOfflineRecoveryHost({directory,hostId:'owner',bridgePath:path.join(directory,'bridge'),runtimePaths:[],inventory:async()=>inventory});close.push(()=>client.close());return client;}
it('recovers a never-started host under the same runtime lock without creating work',async()=>{
  const directory=await fixture(),client=await connect(directory);
  await expect(lockfile.lock(path.join(directory,'mcw-host-runtime'),{realpath:false,retries:0,stale:10000})).rejects.toThrow();
  const work=new RecoveryWorkSession({operationId:'rollback',localHostId:'owner',expectedHostIds:['owner'],client:async()=>client,save:async()=>{}});
  await work.stopNewWork();expect((await work.observeHosts())[0].state).toBe('completed');
  await expect(client.request('/terminals','POST',{})).rejects.toThrow();
  await work.release();expect((await client.request('/recovery/holds/rollback')).releasedAt).not.toBeNull();
});
it('does not substitute offline authority for a locked or kernel-alive host',async()=>{
  const directory=await fixture(),release=await lockfile.lock(path.join(directory,'mcw-host-runtime'),{realpath:false,stale:10000});
  await expect(connect(directory)).rejects.toThrow();await release();
  await writeFile(path.join(directory,'host-process-identity.json'),JSON.stringify({schemaVersion:1,hostId:'owner',process:old}));
  await expect(connect(directory,[old])).rejects.toThrow(/host.*running/i);
  const client=await connect(directory,[{...old,startId:'windows:20',name:'unrelated'}]);
  expect((await client.request('/health')).hostId).toBe('owner');
});
it('proves crashed local attempts stopped without changing their recorded execution or results',async()=>{
  const directory=await fixture(),store=new TaskStore({directory,hostId:'owner'});
  const task=await store.createTask({title:'crash',brief:'test',lead:{hostId:'owner',provider:'claude',profileId:'lead'},workers:[]});
  const lead=task.participants[0],identity={taskId:task.id,participantId:lead.id,attemptId:lead.attempt.id,generation:1,role:lead.role,hostId:'owner'};
  await store.beginDelivery(identity,'launch');await store.resolveDelivery(identity,'launch','delivered');await store.observeExecution(identity,'lost');
  await writeFile(path.join(directory,'terminal-sessions.json'),JSON.stringify({version:2,sessions:[{id:lead.attempt.id,kind:'claude',cwd:directory,projectId:null,createdAt:new Date().toISOString(),generation:`${lead.attempt.id}-1`,tabId:'tab',paneId:'pane',delivery:'delivered',status:'lost',observedAt:null,connected:false,processes:[old]}]}));
  const before=await readFile(store.filePath,'utf8'),client=await connect(directory);
  expect((await client.request('/recovery-plan')).canShutdown).toBe(true);
  expect(await readFile(store.filePath,'utf8')).toBe(before);
});
it('keeps remote dependencies and blocks unattributed uncertain local dispatches',async()=>{
  const directory=await fixture(),store=new TaskStore({directory,hostId:'owner'});
  const task=await store.createTask({title:'remote',brief:'test',lead:{hostId:'owner',provider:'claude',profileId:'lead'},workers:[{hostId:'remote',provider:'codex',profileId:'worker'}]});
  for(const member of task.participants){const identity={taskId:task.id,participantId:member.id,attemptId:member.attempt.id,generation:1,role:member.role,hostId:member.hostId};await store.beginDelivery(identity,'launch');await store.resolveDelivery(identity,'launch','unknown');}
  const client=await connect(directory),plan=await client.request('/recovery-plan');
  expect(plan.related).toEqual([{hostId:'remote',taskIds:[task.id]}]);expect(plan.canShutdown).toBe(false);
});
it('refuses stale backup data',async()=>{
  const directory=await fixture(),store=new TaskStore({directory,hostId:'owner'});
  await store.createTask({title:'task',brief:'test',lead:{hostId:'owner',provider:'claude',profileId:'lead'},workers:[]});
  await writeFile(`${store.filePath}.bak`,await readFile(store.filePath));await writeFile(store.filePath,'broken');
  const client=await connect(directory);await expect(client.request('/recovery-plan')).rejects.toThrow();
});
it('blocks a launched terminal with missing identities, even when its stored status says exited',async()=>{
  const directory=await fixture();
  await writeFile(path.join(directory,'terminal-sessions.json'),JSON.stringify({version:2,sessions:[{id:'session',kind:'shell',cwd:directory,projectId:null,createdAt:new Date().toISOString(),generation:'1',tabId:'tab',paneId:'pane',delivery:'delivered',status:'exited',observedAt:Date.now(),connected:true}]}));
  await expect(connect(directory)).rejects.toThrow('process identity is missing');
});
it('does not overlook an undelivered result from the earlier host outbox format',async()=>{
  const directory=await fixture(),store=new TaskStore({directory,hostId:'owner'});
  await store.queueRemoteResult('remote',{taskId:'remote-task',participantId:'worker',attemptId:'attempt',generation:1,role:'worker',hostId:'owner'},{summary:'retained',changes:[],verification:['test'],artifacts:[],issues:[]});
  const client=await connect(directory);await expect(client.request('/recovery-plan')).rejects.toThrow(/result.*delivery/i);
});
it('rechecks native processes on each request and rejects changed host identity',async()=>{
  const directory=await fixture(),inventory:ProcessIdentity[]=[],client=await connect(directory,inventory);
  await writeFile(path.join(directory,'host-process-identity.json'),JSON.stringify({schemaVersion:1,hostId:'owner',process:old}));
  inventory.push(old);await expect(client.request('/health')).rejects.toThrow(/host.*running/i);
  inventory.length=0;await writeFile(path.join(directory,'host-process-identity.json'),JSON.stringify({schemaVersion:1,hostId:'other',process:old}));
  await expect(client.request('/health')).rejects.toThrow(/identity/i);
});
