import {test,expect,_electron as electron,type ElectronApplication} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInstallFixture,run,type InstallPlatform} from './recovery-install-fixture';
import {requireOfflineRecovery} from './recovery-offline-network';
import {HostClient} from '../src/main/host/host-client';
import {proveLocalProcessesStopped} from '../src/main/recovery/local-process-proof';
import type {RecoveryInstallation,RecoveryOperationState} from '../src/main/recovery/controller-state';

test('original installer offline v1 → v2 → v1.55.1 → v2 preserves both data generations',async({},info)=>{
  const platform=process.env.MCW_RECOVERY_ROUNDTRIP as InstallPlatform|undefined;
  test.skip(!platform,'Original installation tests run only in explicitly enabled disposable CI');
  if(!['win32','deb','appimage'].includes(platform!))throw new Error('Unknown roundtrip platform');
  test.setTimeout(720000);
  const fixture=await createInstallFixture(platform!);
  let app:ElectronApplication|undefined,client:HostClient|undefined,unblockNetwork:(()=>Promise<void>)|undefined,removePolicy:(()=>Promise<void>)|undefined;
  const diagnostics:string[]=[];
  const launch=async(v2:boolean)=>{
    const env=Object.fromEntries(Object.entries(v2?fixture.v2Environment:fixture.environment).filter((entry):entry is [string,string]=>typeof entry[1]==='string'));
    app=await electron.launch({executablePath:fixture.executable,args:[],env,timeout:60000});
    app.process().stderr?.on('data',chunk=>diagnostics.push(String(chunk)));const page=await app.firstWindow();
    expect(await app.evaluate(({app})=>app.getVersion())).toBe(v2?'2.0.0-preview.0':'1.55.1');
    await expect(page.getByRole('menuitem',{name:'설정',exact:true})).toBeVisible();
    await expect(page.getByText('복귀 검증',{exact:true}).first()).toBeVisible();
    if(v2){expect(await page.evaluate(()=>window.mcwV2?.version)).toBe(2);client=new HostClient(JSON.parse(await fs.readFile(path.join(`${fixture.userData}-v2`,'host/mcw-host.json'),'utf8')));}
    return page;
  };
  const close=async()=>{
    if(app){const process=app.process();await app.evaluate(({app})=>app.quit());await expect.poll(()=>process.exitCode,{timeout:20000}).not.toBe(null);app=undefined;}
    if(client){expect(await client.terminals()).toEqual([]);await client.shutdown();client=undefined;}
    await expect.poll(async()=>{try{await fixture.assertNoApps();return true;}catch{return false;}},{timeout:20000}).toBe(true);
  };
  const note={id:'original-note',targetKey:`project:${fixture.projectId}`,path:'fixture.txt',side:'RIGHT',line:1,lineText:'repository remains unchanged',body:'원본 diff 메모',status:'draft',createdAt:Date.now(),sentAt:null};
  const notes=JSON.stringify({version:1,notes:[note]}),favorites=JSON.stringify({favoriteProjectIds:[fixture.projectId],favoritesOpen:true});
  let operationDirectory:string|undefined;
  try{
    await fixture.install('v1');let page=await launch(false);
    await page.evaluate(({notes,favorites})=>{localStorage.setItem('mcw.diffNotes.v1',notes);localStorage.setItem('multi-cli-work.sidebar.v1',favorites);localStorage.setItem('mcw.recovery.fixture','original-v1');},{notes,favorites});
    await page.reload();await expect(page.getByText('복귀 검증',{exact:true}).first()).toBeVisible();
    expect(JSON.parse((await page.evaluate(()=>localStorage.getItem('multi-cli-work.sidebar.v1')))!).favoriteProjectIds).toContain(fixture.projectId);
    await close();
    await fixture.install('v2');page=await launch(true);
    expect(await page.evaluate(()=>localStorage.getItem('mcw.recovery.fixture'))).toBe('original-v1');
    expect(JSON.parse((await page.evaluate(()=>localStorage.getItem('mcw.diffNotes.v1')))!).notes[0].body).toBe(note.body);
    await page.evaluate(()=>localStorage.setItem('mcw.recovery.fixture','preserved-v2'));
    const task=await client!.createTask({title:'보존할 v2 작업',brief:'자동 재실행하지 않습니다.',lead:{hostId:(await client!.health()).hostId,provider:'claude',profileId:'fixture'},workers:[]});
    await fs.writeFile(path.join(`${fixture.userData}-v2`,'v2-output.txt'),'preserved v2 output');
    const installation=JSON.parse(await fs.readFile(path.join(fixture.recoveryRoot,'installation.json'),'utf8')) as RecoveryInstallation;
    const runtime=path.join(installation.assetsDirectory,process.platform==='win32'?'recovery-node.exe':'recovery-node');
    const verifyBackup=()=>run(runtime,[path.join(installation.assetsDirectory,'recover.mjs'),'verify',installation.backupDirectory],{windowsHide:true,timeout:30000,maxBuffer:16*1024*1024});
    const fixedHash=await fixture.digest(path.join(installation.backupDirectory,'manifest.json'));
    await verifyBackup();await close();
    await expect.poll(async()=>{try{await proveLocalProcessesStopped({directory:installation.hostDirectory,hostId:installation.localHostId,bridgePath:installation.bridgePath,runtimePaths:installation.runtimePaths,includeGui:true});return 'stopped';}catch(error){return String(error);}},{timeout:20000}).toBe('stopped');
    removePolicy=await fixture.authorizeOriginalDeb(installation.assetsDirectory);
    const network=await requireOfflineRecovery({platform:fixture.platform,assetsDirectory:installation.assetsDirectory,executable:fixture.executable,candidate:fixture.candidate});unblockNetwork=network.restore;
    const controller=spawn(runtime,[path.join(installation.assetsDirectory,'recovery-controller.cjs'),'begin',path.join(fixture.recoveryRoot,'installation.json')],{env:fixture.environment,windowsHide:true,stdio:['ignore','pipe','pipe']});
    controller.stdout.on('data',chunk=>diagnostics.push(String(chunk)));controller.stderr.on('data',chunk=>diagnostics.push(String(chunk)));
    let launchError:Error|undefined;controller.once('error',error=>{launchError=error;});
    const state=async():Promise<RecoveryOperationState|null>=>{
      try{const pointer=JSON.parse(await fs.readFile(path.join(fixture.recoveryRoot,'active-operation.json'),'utf8'));operationDirectory=path.join(fixture.recoveryRoot,'operations',pointer.operationId);return JSON.parse(await fs.readFile(path.join(operationDirectory,'state.json'),'utf8'));}
      catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
    };
    await expect.poll(async()=>{if(launchError)throw launchError;const current=await state();if(current?.phase==='failed')throw new Error(`Recovery failed in ${current.failedAtPhase}: ${current.error}`);return current?.phase;},{timeout:240000}).toBe('complete');
    await expect.poll(()=>controller.exitCode,{timeout:20000}).toBe(0);
    const complete=(await state())!;expect(complete.launchedV1?.startId).toBeTruthy();
    await fixture.stopLaunchedV1(complete.launchedV1!);
    await removePolicy();removePolicy=undefined;
    page=await launch(false);
    const settings=await page.evaluate(()=>window.multiCliWork.settings.get());
    expect(settings.general).toMatchObject({autoCheckUpdates:false,autoResumeSessions:false,repoSyncOnSessionStart:false});
    expect(await page.evaluate(()=>window.multiCliWork.terminals.list())).toEqual([]);
    expect(await page.evaluate(()=>localStorage.getItem('mcw.recovery.fixture'))).toBe('original-v1');
    expect(JSON.parse((await page.evaluate(()=>localStorage.getItem('multi-cli-work.sidebar.v1')))!).favoriteProjectIds).toContain(fixture.projectId);
    expect(JSON.parse((await page.evaluate(()=>localStorage.getItem('mcw.diffNotes.v1')))!).notes[0].body).toBe(note.body);
    await page.screenshot({path:info.outputPath('restored-original-v1.png')});await close();
    await fs.writeFile(path.join(fixture.userData,'changed-during-v1.txt'),'keep separate from v2');
    expect(await fixture.digest(path.join(installation.backupDirectory,'manifest.json'))).toBe(fixedHash);await verifyBackup();
    await fixture.install('v2');page=await launch(true);
    expect(await page.evaluate(()=>localStorage.getItem('mcw.recovery.fixture'))).toBe('preserved-v2');
    expect(await fs.readFile(path.join(`${fixture.userData}-v2`,'v2-output.txt'),'utf8')).toBe('preserved v2 output');
    expect(await fs.stat(path.join(`${fixture.userData}-v2`,'changed-during-v1.txt')).catch(()=>null)).toBeNull();
    const differences=JSON.parse(await fs.readFile(path.join(fixture.recoveryRoot,'v1-differences.json'),'utf8'));
    expect(differences.added).toContain('userData/changed-during-v1.txt');expect((await client!.tasks()).map(item=>item.id)).toEqual([task.id]);expect(await client!.terminals()).toEqual([]);
    expect(await fixture.digest(path.join(installation.backupDirectory,'manifest.json'))).toBe(fixedHash);
    await page.screenshot({path:info.outputPath('reupgraded-v2.png')});await close();await fixture.assertGitPreserved();
    await fs.writeFile(info.outputPath('roundtrip.json'),JSON.stringify({schemaVersion:1,sourceCommit:process.env.GITHUB_SHA,platform,versions:['1.55.1','2.0.0-preview.0','1.55.1','2.0.0-preview.0'],network:network.evidence,immutableBackupSha256:fixedHash,settingsSuppressed:true,notesFavoritesPreserved:true,v2StatePreserved:true,v1ChangesNotMerged:true,gitWorktreePreserved:true,completedAt:new Date().toISOString()},null,2));
  }catch(error){
    diagnostics.push(String(error));
    if(app){const page=await app.firstWindow().catch(()=>null);if(page){await page.screenshot({path:info.outputPath('failure.png')}).catch(()=>undefined);diagnostics.push(await page.evaluate(()=>document.body.innerText).catch(()=>''));}}
    throw error;
  }finally{
    await close().catch(error=>diagnostics.push(String(error)));
    const cleanup=await Promise.allSettled([removePolicy?.(),unblockNetwork?.()]);
    for(const result of cleanup)if(result.status==='rejected')diagnostics.push(`Fixture cleanup: ${result.reason}`);
    await fs.writeFile(info.outputPath('recovery-diagnostics.txt'),diagnostics.join(''));
    if(operationDirectory)for(const name of ['state.json','recovery.log']){const data=await fs.readFile(path.join(operationDirectory,name)).catch(()=>null);if(data)await fs.writeFile(info.outputPath(name),data);}
    // The entire disposable installation and receipts remain available on failure.
    await info.attach('disposable-fixture',{body:fixture.directory,contentType:'text/plain'});
    if(cleanup.some(result=>result.status==='rejected'))throw new Error('Disposable policy/network cleanup failed; inspect recovery-diagnostics.txt');
  }
});
