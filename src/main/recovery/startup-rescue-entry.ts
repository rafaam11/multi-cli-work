import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {preserveRecoveryRuntime} from '../v2/desktop-host';
import {preserveRecoveryInstallation} from './desktop-recovery';
import {prepareInitialRescueData,assertReplacementStopped,assertInitialRescueStopped} from './startup-rescue';
import {originalInstallTarget} from './install-target';
import {captureV1ProviderEnvironment} from './v1-launch';
import {verifyRecoveryAssets,verifyV1Backup} from './index';
import {requirePlainPath,writeRecoveryState,acquireRecoveryStart} from './controller-state';
import {readProcessInventory} from '../herdr/process-observation';

interface RescueDescriptor {
 schemaVersion:1;v1UserData:string;v1Registry:string;v1ClaudeConfig:string;recoveryRoot:string;
 assetsDirectory:string;installDirectory:string;executablePath:string;platform:'win32'|'deb'|'appimage';
 runtimePaths:string[];v1ProviderEnvironment:Record<string,string>;updaterCaches:{cacheRoot:string;cacheName:string}[];
}
const exists=async(file:string)=>fs.lstat(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
/** Installer/prelaunch path stages assets and launchers only. No data migration,
 * process termination, snapshot of live data or installer execution. */
export async function stageStartupRescue(resources:string,executable:string):Promise<string>{
 if(process.versions.electron)throw new Error('Preflight requires standalone Node before Electron');
 for(const file of [resources,executable])await requirePlainPath(file,true);
 const v1UserData=process.env.MULTI_CLI_WORK_USER_DATA?path.resolve(process.env.MULTI_CLI_WORK_USER_DATA):path.join(process.platform==='win32'?(process.env.APPDATA??path.join(os.homedir(),'AppData/Roaming')):(process.env.XDG_CONFIG_HOME??path.join(os.homedir(),'.config')),'multi-cli-work');
 const recoveryRoot=process.env.MCW_RECOVERY_ROOT??`${v1UserData}-recovery`;
 await requirePlainPath(recoveryRoot,true);await fs.mkdir(recoveryRoot,{recursive:true,mode:0o700});
 const release=await acquireRecoveryStart(recoveryRoot);
 try{
 const assetsDirectory=await preserveRecoveryRuntime(path.join(resources,'v2'),recoveryRoot,path.dirname(executable),path.join(resources,'recovery-scripts'),path.join(resources,'herdr-bridge'));
 const target=originalInstallTarget(process.platform,executable,process.env.APPIMAGE);
 const verified=await verifyRecoveryAssets(assetsDirectory,target.platform);
 if(!verified.manifest.assets.some(asset=>asset.filename==='startup-rescue.cjs'))throw new Error('Pre-Electron rescue executable was not staged');
 const installedResources=path.join(path.dirname(executable),'resources');
 const descriptor:RescueDescriptor={schemaVersion:1,v1UserData,v1Registry:process.env.MCW_V1_REGISTRY??path.join(os.homedir(),'.multi-cli-work'),v1ClaudeConfig:process.env.MULTI_CLI_WORK_CLAUDE_CONFIG_DIR??process.env.CLAUDE_CONFIG_DIR??path.join(os.homedir(),'.claude'),recoveryRoot,assetsDirectory,...target,runtimePaths:[executable,path.join(installedResources,'v2',process.platform==='win32'?'herdr/windows-mcw/herdr.exe':'herdr/herdr-linux-x86_64'),path.join(installedResources,'v2',process.platform==='win32'?'node/windows/node.exe':'node/linux/node')],v1ProviderEnvironment:captureV1ProviderEnvironment(process.env),updaterCaches:[{cacheRoot:process.platform==='win32'?(process.env.LOCALAPPDATA??path.join(os.homedir(),'AppData/Local')):(process.env.XDG_CACHE_HOME??path.join(os.homedir(),'.cache')),cacheName:'multi-cli-work-updater'}]};
 for(const file of [descriptor.v1UserData,descriptor.v1Registry,descriptor.v1ClaudeConfig])await requirePlainPath(file,true);
 const filename=path.join(recoveryRoot,'startup-rescue.json');
 if(await exists(filename)){
  const previous=JSON.parse(await fs.readFile(filename,'utf8'));
  if(previous.v1UserData!==descriptor.v1UserData||previous.v1Registry!==descriptor.v1Registry)throw new Error('Pre-Electron rescue source paths differ; existing record preserved');
 }
 await writeRecoveryState(filename,descriptor);
 const bundle=path.basename(assetsDirectory),windows=process.platform==='win32';
 const launcher=windows?`@echo off\r\n"%~dp0${bundle}\\recovery-node.exe" "%~dp0${bundle}\\startup-rescue.cjs" begin "%~dp0startup-rescue.json"\r\npause\r\n`:`#!/bin/sh\ncd -- "$(dirname -- "$0")" || exit 1\nexec "./${bundle}/recovery-node" "./${bundle}/startup-rescue.cjs" begin "$PWD/startup-rescue.json"\n`;
 await fs.writeFile(path.join(recoveryRoot,`rescue-before-first-start.${windows?'cmd':'sh'}`),launcher,{mode:0o700});
 if(!await exists(path.join(recoveryRoot,'installation.json')))await fs.writeFile(path.join(recoveryRoot,`return-to-v1.${windows?'cmd':'sh'}`),launcher,{mode:0o700});
 return recoveryRoot;
 }finally{await release();}
}

async function prepare(filename:string):Promise<{descriptor:RescueDescriptor;installation:string}>{
 await requirePlainPath(filename);
 const descriptor=JSON.parse(await fs.readFile(filename,'utf8')) as RescueDescriptor;
 if(descriptor.schemaVersion!==1||path.join(descriptor.recoveryRoot,'startup-rescue.json')!==filename)throw new Error('Invalid pre-Electron rescue descriptor');
 await verifyRecoveryAssets(descriptor.assetsDirectory,descriptor.platform);
 const installation=path.join(descriptor.recoveryRoot,'installation.json');
 const release=await acquireRecoveryStart(descriptor.recoveryRoot);
 try{
 if(!await exists(installation)){
  const bridgePath=path.join(descriptor.assetsDirectory,process.platform==='win32'?'recovery-process-bridge.exe':'recovery-process-bridge');
  const assertStopped=async()=>{
   assertInitialRescueStopped(await readProcessInventory(bridgePath),descriptor.runtimePaths);
  };
  const data=await prepareInitialRescueData({...descriptor,assertStopped});
  await preserveRecoveryInstallation({...descriptor,hostId:data.hostId,backupDirectory:data.backupDirectory,userData:data.userData,registryRoot:data.registry,packaged:true});
 }
 const record=JSON.parse(await fs.readFile(installation,'utf8'));
 await verifyV1Backup(record.backupDirectory);
 if(record.targets?.userData!==descriptor.v1UserData||record.targets?.registry!==descriptor.v1Registry)throw new Error('Independent recovery targets differ');
 return {descriptor,installation};
 }finally{await release();}
}

async function main(){
 const [command,first,second]=process.argv.slice(2);
 if(['stage','stage-install'].includes(command)&&first&&second){
  const recoveryRoot=await stageStartupRescue(first,second);
  if(command==='stage-install'){
   const descriptor=JSON.parse(await fs.readFile(path.join(recoveryRoot,'startup-rescue.json'),'utf8')) as RescueDescriptor;
   const bridge=path.join(descriptor.assetsDirectory,process.platform==='win32'?'recovery-process-bridge.exe':'recovery-process-bridge');
   assertReplacementStopped(await readProcessInventory(bridge),path.dirname(second),process.platform);
  }
  return {recoveryRoot};
 }
 if(!['prepare','begin'].includes(command)||!first)throw new Error('Usage: startup-rescue.cjs stage <resources> <executable> | prepare|begin <startup-rescue.json>');
 const {descriptor,installation}=await prepare(first);
 if(command==='prepare')return {prepared:true,installation};
 const child=spawn(path.join(descriptor.assetsDirectory,process.platform==='win32'?'recovery-node.exe':'recovery-node'),[path.join(descriptor.assetsDirectory,'recovery-controller.cjs'),'begin',installation],{stdio:'inherit',windowsHide:true});
 await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`Recovery controller stopped with ${code}`)));});
 return {completed:true};
}
if(require.main===module)void main().then(value=>process.stdout.write(JSON.stringify(value)+'\n')).catch(error=>{process.stderr.write(`Startup rescue blocked: ${error.message}\n`);process.exitCode=1;});
