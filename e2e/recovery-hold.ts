import {expect,type ElectronApplication,type Page,type TestInfo} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readProcessInventory} from '../src/main/herdr/process-observation';
import type {HostClient} from '../src/main/host/host-client';
import type {RecoveryRequest} from '../src/main/recovery/controller-state';

/** Exercises the preserved production adapter with the real host and an active
 * shell. This fixture calls only hold/cancel methods; it cannot invoke an installer. */
export async function exerciseRecoveryHold(options:{directory:string;recovery:string;userData:string;registry:string;app:ElectronApplication;page:Page;client:HostClient;info:TestInfo}){
  const {directory,recovery,userData,registry,app,page,client,info}=options;
  const operationId='recovery-gui-fixture',operationDirectory=path.join(directory,'recovery/operations',operationId);
  await fs.mkdir(operationDirectory,{recursive:true});
  const bridgePath=path.join(recovery,process.platform==='win32'?'recovery-process-bridge.exe':'recovery-process-bridge');
  const guiPid=await app.evaluate(()=>process.pid);
  const guiProcess=(await readProcessInventory(bridgePath)).find(item=>item.pid===guiPid)!;
  const {runtimePaths}=JSON.parse(await fs.readFile(path.join(directory,'recovery/active-host-runtime.json'),'utf8')) as {runtimePaths:string[]};
  const hostId=(await client.health()).hostId;
  const request:RecoveryRequest={schemaVersion:1,operationId,operationDirectory,localHostId:hostId,hostDirectory:path.join(`${userData}-v2`,'host'),bridgePath,guiProcess,runtimePaths,installDirectory:path.join(directory,'unused-install'),executablePath:path.join(directory,'unused-install/unused-executable'),updaterCaches:[],backupDirectory:path.join(directory,'recovery/v1-before-v2'),destination:path.join(operationDirectory,'prepared'),preserveV2Sources:{userData:`${userData}-v2`,registry:`${registry}-v2`},targets:{userData,registry},assetsDirectory:recovery,platform:process.platform==='win32'?'win32':'deb',expectedHostIds:[hostId]};
  const requestFile=path.join(operationDirectory,'request.json');await fs.writeFile(requestFile,JSON.stringify(request));
  await fs.writeFile(path.join(directory,'recovery/active-operation.json'),JSON.stringify({operationId}));
  const script=path.join(operationDirectory,'hold-fixture.cjs');
  await fs.writeFile(script,`const fs=require('node:fs'); const {createAdapter}=require(process.argv[2]); (async()=>{const adapter=await createAdapter(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));try{await adapter.stopNewWork();throw new Error('Active shell must block readiness');}catch(error){if(error.message!=='Recovery cancelled by the user')throw error;await adapter.cancel();}finally{await adapter.close();}})().catch(error=>{console.error(error);process.exitCode=1;});`);
  const runtime=path.join(recovery,process.platform==='win32'?'recovery-node.exe':'recovery-node'),entry=path.join(recovery,'recovery-controller.cjs');
  const child=spawn(runtime,[script,entry,requestFile],{windowsHide:true,stdio:['ignore','pipe','pipe']});let diagnostic='';child.stdout.on('data',chunk=>{diagnostic+=chunk;});child.stderr.on('data',chunk=>{diagnostic+=chunk;});
  const state=async()=>JSON.parse(await fs.readFile(path.join(operationDirectory,'state.json'),'utf8').catch(()=>'{}'));
  try{
    await expect.poll(async()=>({phase:(await state()).phase,exit:child.exitCode}),{timeout:20000}).toEqual({phase:'waiting-work',exit:null});
    expect((await client.health()).accepting).toBe(false);
    await expect(client.createTerminal({sessionId:'must-not-start'})).rejects.toThrow();
    await page.getByRole('menuitem',{name:'설정',exact:true}).click();
    const settings=page.getByRole('dialog',{name:'설정',exact:true});await settings.getByRole('button',{name:'업데이트',exact:true}).click();
    await expect(settings.getByText('관련 작업이 마무리되기를 기다립니다.')).toBeVisible();
    await settings.screenshot({path:info.outputPath('recovery-waiting-work.png')});
    await page.keyboard.press('Escape');
  }finally{
    if(child.exitCode===null)await promisify(execFile)(runtime,[entry,'cancel',requestFile],{windowsHide:true,timeout:20000}).catch(error=>{diagnostic+=String(error);});
    await expect.poll(()=>child.exitCode,{timeout:20000,message:diagnostic}).toBe(0);
    expect((await state()).phase).toBe('cancelled');expect((await client.health()).accepting).toBe(true);
    expect(await fs.stat(request.destination).catch(()=>null)).toBeNull();
  }
}
