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
    if(platform==='win32')await run(file,['/S',`/D=${path.dirname(executable)}`],{env:version==='v2'?v2Environment:environment,windowsHide:true,windowsVerbatimArguments:true,timeout:180000,maxBuffer:4*1024*1024});
    else if(platform==='deb')await run('sudo',['-n','/usr/bin/dpkg','--install',file],{timeout:180000,maxBuffer:4*1024*1024});
    else{await fs.copyFile(file,executable);await fs.chmod(executable,0o700);}
  };
  const authorizeOriginalDeb=async(assetsDirectory:string)=>{
    if(platform!=='deb')return async()=>{};
    assertDisposableRunner();
    const command=`/usr/bin/dpkg --install ${path.join(assetsDirectory,ORIGINAL_INSTALLERS.deb.filename)}`;
    const key=`mcw-recovery-${randomUUID()}`,username=os.userInfo().username;
    if(!/^[a-z_][a-z0-9_-]*[$]?$/.test(username))throw new Error('Unsupported disposable runner account');
    const targets:string[]=[];
    const installPolicy=async(name:string,target:string,contents:string)=>{const source=path.join(directory,name);await fs.writeFile(source,contents);targets.push(target);await run('sudo',['-n','install','-D','-m','0644',source,target],{timeout:10000});};
    const cleanup=async()=>{if(targets.length)await run('sudo',['-n','rm','-f','--',...targets],{timeout:10000});};
    try{
      if(await fs.stat('/etc/polkit-1/rules.d').catch(()=>null)){
        await installPolicy(`${key}.rules`,path.join('/etc/polkit-1/rules.d',`49-${key}.rules`),`polkit.addRule(function(action, subject) { if (action.id === 'org.freedesktop.policykit.exec' && subject.user === ${JSON.stringify(username)} && action.lookup('program') === '/usr/bin/dpkg' && action.lookup('command_line') === ${JSON.stringify(command)}) return polkit.Result.YES; });\n`);
      }else{
        // Ubuntu 22.04's 0.105 local authority uses .pkla, not JavaScript rules.
        // A unique action restricts this short-lived grant to dpkg --install and
        // the disposable runner (which already has passwordless sudo). The real
        // controller still verifies and installs the pinned original artifact.
        const action=`org.multicliwork.${key}`;
        await installPolicy(`${key}.policy`,path.join('/usr/share/polkit-1/actions',`${action}.policy`),`<?xml version="1.0" encoding="UTF-8"?><policyconfig><action id="${action}"><description>Disposable MCW recovery installer test</description><message>Install original MCW fixture</message><defaults><allow_any>no</allow_any><allow_inactive>no</allow_inactive><allow_active>no</allow_active></defaults><annotate key="org.freedesktop.policykit.exec.path">/usr/bin/dpkg</annotate><annotate key="org.freedesktop.policykit.exec.argv1">--install</annotate></action></policyconfig>\n`);
        await installPolicy(`${key}.pkla`,path.join('/etc/polkit-1/localauthority/50-local.d',`${key}.pkla`),`[Disposable recovery]\nIdentity=unix-user:${username}\nAction=${action}\nResultAny=yes\nResultInactive=yes\nResultActive=yes\n`);
      }
      return cleanup;
    }catch(error){await cleanup();throw error;}
  };
  const stopLaunchedV1=async(identity:ProcessIdentity)=>{
    assertDisposableRunner();let owned:ProcessIdentity[]=[];
    // Electron starts and retires utility children while the native snapshot
    // is read. Retry observation only; never signal an unidentified process.
    await expect.poll(async()=>{
      const inventory=await readProcessInventory(bridge),actual=inventory.find(item=>item.pid===identity.pid);
      expect(actual?.startId).toBe(identity.startId);
      const tree=captureProcessTree(identity.pid,inventory);
      if(tree.some(item=>!item.startId))return false;
      owned=tree;return true;
    },{timeout:10000,message:'Fixture process tree must have native creation identities before cleanup'}).toBe(true);
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
