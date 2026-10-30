import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect} from '@playwright/test';
import {assertDisposableRunner} from '../scripts/recovery/disposable-runner.mjs';
import assets from '../scripts/v2/assets.json';
import {readProcessInventory,captureProcessTree,type ProcessIdentity} from '../src/main/herdr/process-observation';
import {findRecoveryProcesses} from '../src/main/recovery/residual-processes';
import {v1LaunchEnvironment} from '../src/main/recovery/v1-launch';

export type InstallPlatform='win32'|'deb'|'appimage';
export const run=promisify(execFile);
export const ORIGINAL_INSTALLERS=Object.fromEntries(Object.entries({win32:'recovery-windows',deb:'recovery-deb',appimage:'recovery-appimage'}).map(([platform,id])=>{const asset=assets.assets.find(item=>item.id===id)!;return [platform,{filename:path.basename(asset.file),sha256:asset.sha256}];})) as Record<InstallPlatform,{filename:string;sha256:string}>;
const digest=async(file:string)=>createHash('sha256').update(await fs.readFile(file)).digest('hex');

export async function createInstallFixture(platform:InstallPlatform){
  assertDisposableRunner();
  if((platform==='win32')!==(process.platform==='win32'))throw new Error('Fixture platform differs');
  const directory=await fs.realpath(await fs.mkdtemp(path.join(process.env.RUNNER_TEMP!,'mcw-install-roundtrip-')));
  const userData=path.join(directory,'v1-data'),registry=path.join(directory,'v1-registry'),recoveryRoot=path.join(directory,'recovery'),project=path.join(directory,'git-project'),worktree=path.join(directory,'git-worktree');
  for(const folder of [userData,registry,project,path.join(directory,'claude'),path.join(directory,'codex')])await fs.mkdir(folder);
  const bridge=path.resolve(`build/herdr-bridge/${process.platform}-${process.arch}/${process.platform==='win32'?'mcw-herdr-bridge.exe':'mcw-herdr-bridge'}`);
  const assertNoApps=async()=>{
    const residual=findRecoveryProcesses(await readProcessInventory(bridge),{applicationNames:['Multi CLI Work.exe','Multi CLI Work Preview.exe','multi-cli-work','multi-cli-work-preview'],runtimePaths:[],trackedPids:[]},process.platform);
    if(residual.length)throw new Error('Another MCW instance exists in the disposable runner; installer was not invoked');
  };
  await assertNoApps();
  const git=(...args:string[])=>run('git',['-C',project,...args],{windowsHide:true,timeout:20000});
  await git('init');await fs.writeFile(path.join(project,'fixture.txt'),'repository remains unchanged\n');await git('add','.');
  await git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture');await git('worktree','add','--detach',worktree,'HEAD');
  await fs.writeFile(path.join(worktree,'output.txt'),'external worktree output must survive');
  const originalHead=(await git('rev-parse','HEAD')).stdout.trim();
  const projectId='11111111-1111-4111-8111-111111111111',now=new Date().toISOString();
  await fs.writeFile(path.join(registry,'projects.json'),JSON.stringify({schemaVersion:1,updatedAt:now,projects:{[projectId]:{id:projectId,rootPath:project,displayName:'복귀 검증',sources:['manual'],providerRefs:{claude:[],codex:[]},status:'진행중',memo:'원본 메모',tracks:[],hidden:false,order:0,createdAt:now,updatedAt:now}}}));
  // No sessions exist. True flags let restoration prove that it disables replay/update.
  await fs.writeFile(path.join(userData,'settings.json'),JSON.stringify({general:{autoCheckUpdates:true,autoResumeSessions:true,repoSyncOnSessionStart:true}}));
  const providerEnvironment={MULTI_CLI_WORK_CLAUDE_CONFIG_DIR:path.join(directory,'claude'),MULTI_CLI_WORK_CODEX_SESSIONS_DIR:path.join(directory,'codex'),CLAUDE_CONFIG_DIR:path.join(directory,'claude'),CODEX_HOME:path.join(directory,'codex')};
  const environment=v1LaunchEnvironment(process.env,{userData,registry},providerEnvironment);
  const v2Environment={...environment,MCW_V1_REGISTRY:registry,MCW_RECOVERY_ROOT:recoveryRoot};
  const executable=platform==='win32'?path.join(directory,'installed/Multi CLI Work.exe'):platform==='deb'?'/opt/Multi CLI Work/multi-cli-work':path.join(directory,'MCW.AppImage');
  const original=path.resolve('build/v2/recovery',ORIGINAL_INSTALLERS[platform].filename);
  expect(await digest(original)).toBe(ORIGINAL_INSTALLERS[platform].sha256);
  const extension=platform==='win32'?'.exe':platform==='deb'?'.deb':'.AppImage';
  const candidates=(await fs.readdir('release-v2-recovery')).filter(name=>name.startsWith('MCW-Recovery-Candidate-')&&name.endsWith(extension));
  expect(candidates).toHaveLength(1);const candidate=path.resolve('release-v2-recovery',candidates[0]);
  const install=async(version:'v1'|'v2')=>{
    assertDisposableRunner();await assertNoApps();const file=version==='v1'?original:candidate;
    if(version==='v1')expect(await digest(file)).toBe(ORIGINAL_INSTALLERS[platform].sha256);
    if(platform==='win32')await run(file,['/S',`/D=${path.dirname(executable)}`],{windowsHide:true,windowsVerbatimArguments:true,timeout:180000,maxBuffer:4*1024*1024});
    else if(platform==='deb')await run('sudo',['-n','/usr/bin/dpkg','--install',file],{timeout:180000,maxBuffer:4*1024*1024});
    else{await fs.copyFile(file,executable);await fs.chmod(executable,0o700);}
  };
  const authorizeOriginalDeb=async(assetsDirectory:string)=>{
    if(platform!=='deb')return async()=>{};
    const command=`/usr/bin/dpkg --install ${path.join(assetsDirectory,ORIGINAL_INSTALLERS.deb.filename)}`;
    const filename=`49-mcw-recovery-${randomUUID()}.rules`,source=path.join(directory,filename),target=path.join('/etc/polkit-1/rules.d',filename);
    const rule=`polkit.addRule(function(action, subject) { if (action.id === 'org.freedesktop.policykit.exec' && subject.user === ${JSON.stringify(os.userInfo().username)} && action.lookup('program') === '/usr/bin/dpkg' && action.lookup('command_line') === ${JSON.stringify(command)}) return polkit.Result.YES; });\n`;
    await fs.writeFile(source,rule);await run('sudo',['-n','install','-m','0644',source,target],{timeout:10000});
    return async()=>{await run('sudo',['-n','rm','--',target],{timeout:10000});};
  };
  const stopLaunchedV1=async(identity:ProcessIdentity)=>{
    assertDisposableRunner();const inventory=await readProcessInventory(bridge),actual=inventory.find(item=>item.pid===identity.pid);
    expect(actual?.startId).toBe(identity.startId);
    const owned=captureProcessTree(identity.pid,inventory);if(owned.some(item=>!item.startId))throw new Error('Fixture process tree cannot be identified');
    // Only this no-session fixture's newly launched v1 is stopped. A developer
    // process can never reach this code, and each PID is rechecked for reuse.
    for(const known of owned){const fresh=(await readProcessInventory(bridge)).find(item=>item.pid===known.pid);if(fresh?.startId===known.startId)try{process.kill(known.pid,'SIGTERM');}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;}}
    await expect.poll(async()=>{try{await assertNoApps();return true;}catch{return false;}},{timeout:20000}).toBe(true);
  };
  const assertGitPreserved=async()=>{
    expect((await git('rev-parse','HEAD')).stdout.trim()).toBe(originalHead);expect((await git('status','--porcelain')).stdout.trim()).toBe('');
    expect(await fs.readFile(path.join(worktree,'output.txt'),'utf8')).toBe('external worktree output must survive');
  };
  return {platform,directory,userData,registry,recoveryRoot,projectId,executable,original,candidate,environment,v2Environment,bridge,install,authorizeOriginalDeb,stopLaunchedV1,assertGitPreserved,assertNoApps,digest};
}
