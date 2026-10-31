import {test,expect,_electron as electron} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInstallFixture,run,type InstallPlatform} from './recovery-install-fixture';
import {requireOfflineRecovery} from './recovery-offline-network';
import type {RecoveryOperationState} from '../src/main/recovery/controller-state';

test('independent rescue restores original v1 offline when the first v2 Electron executable cannot start',async({},info)=>{
 const platform=process.env.MCW_RECOVERY_ROUNDTRIP as InstallPlatform|undefined;
 test.skip(!platform,'Original installers execute only in disposable hosted CI');
 test.setTimeout(600000);
 const fixture=await createInstallFixture(platform!),diagnostics:string[]=[];
 let removePolicy:(()=>Promise<void>)|undefined,restoreNetwork:(()=>Promise<void>)|undefined;
 try{
  await fixture.install('v1');
  await fs.mkdir(path.join(fixture.userData,'Local Storage'),{recursive:true});
  await fs.writeFile(path.join(fixture.userData,'Local Storage/first-start-fixture'),'actual-v1-before-electron');
  await fixture.install('v2');
  let executable=fixture.executable;let env:NodeJS.ProcessEnv=fixture.v2Environment;
  if(platform==='appimage'){
   await run(fixture.executable,['--appimage-extract'],{cwd:fixture.directory,env,timeout:60000,maxBuffer:16*1024*1024});
   const extracted=path.join(fixture.directory,'squashfs-root');
   executable=path.join(extracted,'multi-cli-work');env={...env,APPIMAGE:fixture.executable,APPDIR:extracted};
  }
  // The first Electron instruction never executes. Windows has already staged
  // during NSIS; the Linux wrapper stages before trying its missing payload.
  const payload=platform==='win32'?executable:`${executable}.electron`;
  // dpkg owns /opt; inject this failure with the same disposable-runner
  // privilege used to install the package, without loosening its permissions.
  if(platform==='deb')await run('sudo',['-n','mv','--',payload,`${payload}.first-start-failure`],{timeout:30000});
  else await fs.rename(payload,`${payload}.first-start-failure`);
  await expect(run(executable,[],{env,windowsHide:true,timeout:30000,maxBuffer:1024*1024})).rejects.toThrow();
  const descriptor=JSON.parse(await fs.readFile(path.join(fixture.recoveryRoot,'startup-rescue.json'),'utf8'));
  expect(descriptor.v1UserData).toBe(fixture.userData);expect(descriptor.v1Registry).toBe(fixture.registry);
  expect(descriptor.platform).toBe(platform);
  if(platform==='appimage')expect(descriptor.executablePath).toBe(fixture.executable);
  expect(await fs.stat(path.join(fixture.recoveryRoot,'installation.json')).catch(()=>null)).toBeNull();
  expect(await fs.stat(`${fixture.userData}-v2`).catch(()=>null)).toBeNull();
  const assetsDirectory=descriptor.assetsDirectory,runtime=path.join(assetsDirectory,platform==='win32'?'recovery-node.exe':'recovery-node');
  removePolicy=await fixture.authorizeOriginalDeb(assetsDirectory);
  const network=await requireOfflineRecovery({platform:platform!,assetsDirectory,executable:fixture.executable,candidate:fixture.candidate});restoreNetwork=network.restore;
  const child=spawn(runtime,[path.join(assetsDirectory,'startup-rescue.cjs'),'begin',path.join(fixture.recoveryRoot,'startup-rescue.json')],{env:fixture.environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',value=>diagnostics.push(String(value)));child.stderr.on('data',value=>diagnostics.push(String(value)));
  let spawnError:Error|undefined;child.once('error',error=>{spawnError=error;});
  const state=async():Promise<RecoveryOperationState|null>=>{
   try{const active=JSON.parse(await fs.readFile(path.join(fixture.recoveryRoot,'active-operation.json'),'utf8'));return JSON.parse(await fs.readFile(path.join(fixture.recoveryRoot,'operations',active.operationId,'state.json'),'utf8'));}
   catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  };
  await expect.poll(async()=>{if(spawnError)throw spawnError;const current=await state();if(current?.phase==='failed')throw new Error(current.error);if(child.exitCode!==null&&child.exitCode!==0)throw new Error(diagnostics.join(''));return current?.phase;},{timeout:240000}).toBe('complete');
  await expect.poll(()=>child.exitCode,{timeout:20000}).toBe(0);
  await fixture.stopLaunchedV1((await state())!.launchedV1!);
  const installed=await electron.launch({executablePath:fixture.executable,env:Object.fromEntries(Object.entries(fixture.environment).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),args:[],timeout:60000});
  try{
   expect(await installed.evaluate(({app})=>app.getVersion())).toBe('1.55.1');
   expect(await installed.evaluate(({app})=>app.getPath('userData'))).toBe(fixture.userData);
   expect(await fs.readFile(path.join(fixture.userData,'Local Storage/first-start-fixture'),'utf8')).toBe('actual-v1-before-electron');
   const settings=JSON.parse(await fs.readFile(path.join(fixture.userData,'settings.json'),'utf8'));
   expect(settings.general).toMatchObject({autoCheckUpdates:false,autoResumeSessions:false,repoSyncOnSessionStart:false});
  }finally{
   const process=installed.process();
   try{await installed.evaluate(({app})=>app.quit());}
   catch(error){
    // A successful quit can close the debugging transport before its evaluate
    // response arrives. Still require a clean OS process exit below.
    if(!String(error).includes('Target page, context or browser has been closed'))throw error;
   }
   await expect.poll(()=>process.exitCode,{timeout:20000}).toBe(0);
  }
  await fixture.assertGitPreserved();
  await fs.writeFile(info.outputPath('startup-rescue.json'),JSON.stringify({platform,sourceCommit:process.env.GITHUB_SHA,electronNeverStarted:true,independentLauncher:true,actualDataPreserved:true,originalVersion:'1.55.1',network:network.evidence},null,2));
 }finally{
  await removePolicy?.();await restoreNetwork?.();
  await fs.writeFile(info.outputPath('startup-rescue-diagnostics.txt'),diagnostics.join(''));
  await info.attach('disposable-fixture',{body:fixture.directory,contentType:'text/plain'});
 }
});
