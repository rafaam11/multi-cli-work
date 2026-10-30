import {expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {proveLocalProcessesStopped} from '../src/main/recovery/local-process-proof';
import {readProcessInventory} from '../src/main/herdr/process-observation';
import {findRecoveryProcesses} from '../src/main/recovery/residual-processes';
import type {RecoveryRequest} from '../src/main/recovery/controller-state';

/** Real native exit proof and preserved production controller after both GUI
 * and daemon exit. No installer/data-restore methods are invoked by this probe. */
export async function exerciseOfflineRecovery(directory:string){
  const previous=JSON.parse(await fs.readFile(path.join(directory,'recovery/operations/recovery-gui-fixture/request.json'),'utf8')) as RecoveryRequest;
  await expect.poll(async()=>{
    try{await proveLocalProcessesStopped({directory:previous.hostDirectory,hostId:previous.localHostId,bridgePath:previous.bridgePath,runtimePaths:previous.runtimePaths});return 'stopped';}catch(error){return String(error);}
  },{timeout:20000}).toBe('stopped');
  const otherApps=findRecoveryProcesses(await readProcessInventory(previous.bridgePath),{applicationNames:['Multi CLI Work.exe','Multi CLI Work Preview.exe','multi-cli-work','multi-cli-work-preview'],runtimePaths:[],trackedPids:[]},process.platform);
  if(process.env.CI)expect(otherApps,'Isolated CI must exercise the full offline progression').toHaveLength(0);
  const operationId='recovery-offline-fixture',operationDirectory=path.join(directory,'recovery/operations',operationId);await fs.mkdir(operationDirectory);
  const request={...previous,operationId,operationDirectory,destination:path.join(operationDirectory,'prepared'),guiProcess:null};
  const requestFile=path.join(operationDirectory,'request.json');await fs.writeFile(requestFile,JSON.stringify(request));
  const script=path.join(operationDirectory,'offline-fixture.cjs');
  await fs.writeFile(script,`const fs=require('node:fs');const assert=require('node:assert/strict');const {createAdapter}=require(process.argv[2]);(async()=>{const adapter=await createAdapter(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));try{await adapter.stopNewWork();assert.equal((await adapter.observeHosts())[0].state,'completed');if(process.argv[4]==='blocked'){await assert.rejects(adapter.assertNoInstances(),/Other MCW runtime instances/);}else{await adapter.gracefulStop();await adapter.assertNoInstances();}await adapter.cancel();assert.equal(adapter.state().phase,'cancelled');}finally{await adapter.close();}})().catch(error=>{console.error(error);process.exitCode=1;});`);
  const records=['tasks-v2.json','worker-replicas-v2.json','terminal-sessions.json'];
  const snapshot=()=>Promise.all(records.map(file=>fs.readFile(path.join(request.hostDirectory,file),'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;})));
  const before=await snapshot();
  await promisify(execFile)(path.join(request.assetsDirectory,process.platform==='win32'?'recovery-node.exe':'recovery-node'),[script,path.join(request.assetsDirectory,'recovery-controller.cjs'),requestFile,otherApps.length?'blocked':'stopped'],{windowsHide:true,timeout:30000});
  if(otherApps.length)console.log('Offline admission/readiness verified; other MCW apps correctly block installation. Full stopped progression is reserved for isolated CI.');
  expect(await snapshot()).toEqual(before);expect(await fs.stat(request.destination).catch(()=>null)).toBeNull();
}
