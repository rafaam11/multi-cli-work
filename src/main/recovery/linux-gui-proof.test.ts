// @vitest-environment node
import {copyFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {expect,it} from 'vitest';
import {readProcessInventory} from '../herdr/process-observation';
import {assertInitialRescueStopped,assertReplacementStopped} from './startup-rescue';
import {proveLocalProcessesStopped} from './local-process-proof';

const bridge=process.env.MCW_BRIDGE_TEST_BINARY??path.resolve('build/herdr-bridge/linux-x64/mcw-herdr-bridge');
it.skipIf(process.platform!=='linux'||!existsSync(bridge))('refuses a real renamed Linux process through initial and established independent recovery with no GUI request identity',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mcw-native-gui-proof-')),payload=path.join(root,'multi-cli-work.electron'),host=path.join(root,'host');
 await mkdir(host);await copyFile('/bin/sleep',payload);
 // A real ELF process gives the same kernel executable/comm truncation as the
 // packaged Electron payload, without creating a window or modifying an app.
 const child=spawn(payload,['30'],{stdio:'ignore'});
 try{
  await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  const inventory=await readProcessInventory(bridge),actual=inventory.find(item=>item.pid===child.pid)!;
  expect(actual.executable).toBe(payload);expect(actual.name).toBe('multi-cli-work.');expect(actual.startId).toBeTruthy();
  expect(()=>assertInitialRescueStopped(inventory,[])).toThrow(/processes remain/);
  expect(()=>assertReplacementStopped(inventory,path.join(root,'another-install'),'linux')).toThrow(/MCW is running/);
  await expect(proveLocalProcessesStopped({directory:host,hostId:'fixture',bridgePath:bridge,runtimePaths:[],guiProcess:null,includeGui:true,inventory:async()=>inventory})).rejects.toThrow(/instances remain/);
  // Exact executable paths also protect against a changed process display name.
  const renamed=inventory.map(item=>item.pid===child.pid?{...item,name:'unrelated-title'}:item);
  await expect(proveLocalProcessesStopped({directory:host,hostId:'fixture',bridgePath:bridge,runtimePaths:[payload],guiProcess:null,includeGui:true,inventory:async()=>renamed})).rejects.toThrow(/instances remain/);
 }finally{
  if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  await rm(root,{recursive:true,force:true});
 }
});
