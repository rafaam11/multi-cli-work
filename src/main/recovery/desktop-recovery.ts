import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {HostClient} from '../host/host-client';
import type {RecoveryStatus,RecoveryInstallerPlatform} from '../../shared/recovery-types';
import {readProcessInventory} from '../herdr/process-observation';
import {readRecoveryState,writeRecoveryState,requirePlainPath,acquireRecoveryStart,type RecoveryRequest,type RecoveryInstallation} from './controller-state';
import {verifyRecoveryAssets,verifyV1Backup} from './index';

interface Options {
  client:HostClient;hostId:string;backupDirectory:string;recoveryRoot:string;assetsDirectory:string;
  userData:string;registryRoot:string;installDirectory:string;executablePath:string;runtimePaths:string[];
  platform:RecoveryInstallerPlatform;packaged:boolean;updaterCaches:{cacheRoot:string;cacheName:string}[];
  suspendUpdater():()=>void;quit():Promise<void>;openDirectory(directory:string):Promise<unknown>;
}
export interface DesktopRecovery {status():Promise<RecoveryStatus>;start():Promise<RecoveryStatus>;cancel():Promise<RecoveryStatus>;open():Promise<void>;prepareQuit():Promise<void>}
export async function activeRecoveryDirectory(root:string):Promise<string|null>{
  let pointer:{operationId:string};try{pointer=JSON.parse(await fs.readFile(path.join(root,'active-operation.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  if(!pointer||!/^[-\w]{1,128}$/.test(pointer.operationId))throw new Error('Invalid active recovery operation');
  const directory=path.join(root,'operations',pointer.operationId);await requirePlainPath(directory);return directory;
}
const applying=new Set(['installing','verifying-install','clearing-updater','launching']);
export async function assertRecoveryStartupAllowed(root:string):Promise<void>{
  const directory=await activeRecoveryDirectory(root);if(!directory)return;
  const state=await readRecoveryState(directory);
  if(!state||!['cancelled','complete','failed'].includes(state.phase))throw new Error(`v1 복귀가 진행 중입니다. 독립 복구 실행기에서 상태를 확인하거나 취소하세요: ${directory}`);
  if(state.failedAtPhase&&applying.has(state.failedAtPhase))throw new Error(`설치 또는 데이터 복원이 중단되었습니다. 보존된 복구 기록을 확인해야 합니다: ${directory}`);
}
export async function preserveRecoveryInstallation(options:Omit<Options,'client'|'suspendUpdater'|'quit'|'openDirectory'>):Promise<void>{
  if(options.packaged){
    const backup=await verifyV1Backup(options.backupDirectory);
    const installation:RecoveryInstallation={schemaVersion:1,packaged:true,recoveryRoot:options.recoveryRoot,localHostId:options.hostId,hostDirectory:path.join(options.userData,'host'),bridgePath:path.join(options.assetsDirectory,process.platform==='win32'?'recovery-process-bridge.exe':'recovery-process-bridge'),runtimePaths:options.runtimePaths,installDirectory:options.installDirectory,executablePath:options.executablePath,updaterCaches:options.updaterCaches,backupDirectory:options.backupDirectory,preserveV2Sources:{userData:options.userData,registry:options.registryRoot},targets:{userData:backup.sources.userData,registry:backup.sources.registry},assetsDirectory:options.assetsDirectory,platform:options.platform};
    await writeRecoveryState(path.join(options.recoveryRoot,'installation.json'),installation);
    const bundle=path.basename(options.assetsDirectory);if(!/^v1\.55\.1-recovery-[a-f0-9]{16}$/.test(bundle)||path.dirname(options.assetsDirectory)!==options.recoveryRoot)throw new Error('Independent recovery runtime location differs');
    for(const [name,command] of [['return-to-v1','begin'],['recovery-status','status'],['cancel-return-to-v1','cancel']]){
      const text=process.platform==='win32'?`@echo off\r\n"%~dp0${bundle}\\recovery-node.exe" "%~dp0${bundle}\\recovery-controller.cjs" ${command} "%~dp0installation.json"\r\npause\r\n`:`#!/bin/sh\ncd -- "$(dirname -- "$0")" || exit 1\nexec "./${bundle}/recovery-node" "./${bundle}/recovery-controller.cjs" ${command} "$PWD/installation.json"\n`;
      await fs.writeFile(path.join(options.recoveryRoot,`${name}.${process.platform==='win32'?'cmd':'sh'}`),text,{mode:0o700});
    }
  }
}
/** Renderer receives status and explicit actions only, never executable paths,
 * lifecycle callbacks or tokens supplied as mutation arguments. */
export async function createDesktopRecovery(options:Options):Promise<DesktopRecovery>{
  let busy=false,monitor:ReturnType<typeof setInterval>|undefined,resumeUpdater:(()=>void)|undefined;
  const previousDirectory=await activeRecoveryDirectory(options.recoveryRoot),previousState=previousDirectory?await readRecoveryState(previousDirectory):null;
  if(previousState&&!['cancelled','complete'].includes(previousState.phase))resumeUpdater=options.suspendUpdater();
  const runtime=path.join(options.assetsDirectory,process.platform==='win32'?'recovery-node.exe':'recovery-node');
  const entry=path.join(options.assetsDirectory,'recovery-controller.cjs');
  const status=async():Promise<RecoveryStatus>=>{
    const directory=await activeRecoveryDirectory(options.recoveryRoot),state=directory?await readRecoveryState(directory):null;
    const needsInspection=!!state?.failedAtPhase&&applying.has(state.failedAtPhase);
    return {available:options.packaged&&!needsInspection,backupDirectory:options.backupDirectory,assetsDirectory:options.assetsDirectory,...(!options.packaged?{reason:'원본 설치본으로 복귀하는 기능은 설치된 앱에서 사용할 수 있습니다.'}:needsInspection?{reason:'중단된 설치·데이터 복원 기록을 먼저 확인하세요.'}:{}),...(state?{operation:{id:state.operationId,phase:state.phase,observations:state.observations,error:state.error,needsInspection,canCancel:['starting','holding','waiting-work','waiting-gui','failed'].includes(state.phase)}}:{})};
  };
  const prepareQuit=async()=>{
    const current=await status();
    if(current.operation&&!['complete','cancelled'].includes(current.operation.phase)&&!resumeUpdater)resumeUpdater=options.suspendUpdater();
  };
  let checking=false;
  const watch=async()=>{
    if(checking)return;checking=true;
    try{
      const directory=await activeRecoveryDirectory(options.recoveryRoot),current=directory?await readRecoveryState(directory):null;
      if(!current)return;
      if(!['complete','cancelled'].includes(current.phase)&&!resumeUpdater)resumeUpdater=options.suspendUpdater();
      if(current.phase==='waiting-gui'){clearInterval(monitor);monitor=undefined;await options.quit();}
      else if(current.phase==='cancelled'){resumeUpdater?.();resumeUpdater=undefined;}
    }finally{checking=false;}
  };
  monitor=setInterval(()=>{void watch().catch(()=>undefined);},500);monitor.unref();
  const start=async()=>{
    if(busy)throw new Error('복귀 준비 요청을 처리 중입니다.');busy=true;
    try{
      if(!options.packaged)throw new Error('설치된 앱에서 복귀를 시작하세요.');
      const release=await acquireRecoveryStart(options.recoveryRoot);
      try{
      const previous=await status();if(!previous.available)throw new Error(previous.reason);if(previous.operation&&!['complete','cancelled'].includes(previous.operation.phase))throw new Error('기존 복귀 작업을 확인하거나 취소하세요.');
      await verifyRecoveryAssets(options.assetsDirectory,options.platform);
      const backup=await verifyV1Backup(options.backupDirectory);
      const plan=await options.client.request<{hostId:string;related:{hostId:string}[]}>('/recovery-plan');
      if(plan.hostId!==options.hostId||!Array.isArray(plan.related))throw new Error('관련 호스트를 확인할 수 없습니다.');
      const operationId=randomUUID(),operationDirectory=path.join(options.recoveryRoot,'operations',operationId);
      await requirePlainPath(operationDirectory,true);await fs.mkdir(operationDirectory,{recursive:true,mode:0o700});
      const bridgePath=path.join(options.assetsDirectory,process.platform==='win32'?'recovery-process-bridge.exe':'recovery-process-bridge');
      const guiProcess=(await readProcessInventory(bridgePath)).find(processInfo=>processInfo.pid===process.pid);if(!guiProcess?.startId)throw new Error('앱 프로세스를 확인할 수 없습니다.');
      const request:RecoveryRequest={schemaVersion:1,operationId,operationDirectory,localHostId:options.hostId,hostDirectory:path.join(options.userData,'host'),bridgePath,guiProcess,runtimePaths:options.runtimePaths,installDirectory:options.installDirectory,executablePath:options.executablePath,updaterCaches:options.updaterCaches,backupDirectory:options.backupDirectory,destination:path.join(operationDirectory,'prepared'),preserveV2Sources:{userData:options.userData,registry:options.registryRoot},targets:{userData:backup.sources.userData,registry:backup.sources.registry},assetsDirectory:options.assetsDirectory,platform:options.platform,expectedHostIds:[options.hostId,...plan.related.map(item=>item.hostId)]};
      await writeRecoveryState(path.join(operationDirectory,'request.json'),request);
      await writeRecoveryState(path.join(operationDirectory,'state.json'),{schemaVersion:1,operationId,phase:'starting',scopes:[],observations:[],updatedAt:Date.now()});
      await writeRecoveryState(path.join(options.recoveryRoot,'active-operation.json'),{operationId});
      resumeUpdater??=options.suspendUpdater();
      const log=await fs.open(path.join(operationDirectory,'recovery.log'),'a',0o600);
      try{
        const child=spawn(runtime,[entry,'rollback',path.join(operationDirectory,'request.json')],{cwd:options.assetsDirectory,detached:true,windowsHide:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
        await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
      }catch(error){await writeRecoveryState(path.join(operationDirectory,'state.json'),{schemaVersion:1,operationId,phase:'failed',failedAtPhase:'starting',error:error instanceof Error?error.message:'복구 실행기를 시작하지 못했습니다.',scopes:[],observations:[],updatedAt:Date.now()});throw error;}
      finally{await log.close();}
      return status();
      }finally{await release();}
    }finally{busy=false;}
  };
  return {status,start,prepareQuit,cancel:async()=>{
    if(busy)throw new Error('복귀 준비 요청을 처리 중입니다.');
    const directory=await activeRecoveryDirectory(options.recoveryRoot);if(!directory)throw new Error('진행 중인 복귀가 없습니다.');
    await verifyRecoveryAssets(options.assetsDirectory,options.platform);
    await promisify(execFile)(runtime,[entry,'cancel',path.join(directory,'request.json')],{cwd:options.assetsDirectory,windowsHide:true,timeout:60000,maxBuffer:1024*1024});
    const result=await status();if(result.operation?.phase==='cancelled'){resumeUpdater?.();resumeUpdater=undefined;}return result;
  },open:async()=>{await options.openDirectory(options.recoveryRoot);}};
}
