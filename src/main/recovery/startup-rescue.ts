import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {getV2DataLayout,createV1Backup,verifyV1Backup,createModBackup,verifyModBackup} from './index';
import {requirePlainPath,writeRecoveryState} from './controller-state';
import {discoverV1ModSources} from './mod-sources';
import type {ProcessIdentity} from '../herdr/process-observation';
import {findRecoveryProcesses,MCW_GUI_PROCESS_NAMES} from './residual-processes';

export function assertInitialRescueStopped(inventory:ProcessIdentity[],runtimePaths:string[],platform:NodeJS.Platform=process.platform){
 const running=findRecoveryProcesses(inventory,{applicationNames:[...MCW_GUI_PROCESS_NAMES,'codex','codex.exe','claude','claude.exe','herdr','herdr.exe'],runtimePaths,trackedPids:[]},platform).filter(item=>item.pid!==process.pid);
 if(running.length)throw new Error(`MCW or provider processes remain (${running.map(item=>`${item.pid}: ${item.executable??item.name}`).join(', ')}); close work explicitly before rescue. No process was stopped.`);
}

/** Admission only: never stop a process or use a PID from an earlier inventory. */
export function assertReplacementStopped(inventory:ProcessIdentity[],installDirectory:string,platform:NodeJS.Platform){
 const paths=platform==='win32'?path.win32:path.posix;
 const normalize=(value:string)=>platform==='win32'?value.toLowerCase():value;
 const root=normalize(paths.resolve(installDirectory));
 for(const processInfo of inventory){
  if(processInfo.pid===process.pid)continue;
  const isGui=findRecoveryProcesses([processInfo],{applicationNames:MCW_GUI_PROCESS_NAMES,runtimePaths:[],trackedPids:[]},platform).length>0;
  // The pinned legacy uninstaller can close every matching GUI name, even in
  // another install directory. Refuse instead of permitting its force-close.
  if(isGui){
   if(!processInfo.executable||!processInfo.startId)throw new Error(`MCW process ${processInfo.pid} is unobserved; replacement is blocked`);
   throw new Error(`MCW is running: PID ${processInfo.pid}, ${processInfo.executable}. Close it explicitly; no process was stopped.`);
  }
  if(processInfo.executable){
   const relative=paths.relative(root,normalize(paths.resolve(processInfo.executable)));
   if(!relative||(!relative.startsWith(`..${paths.sep}`)&&relative!=='..'&&!paths.isAbsolute(relative)))throw new Error('A native process is running from the replacement directory; close it explicitly');
  }
 }
}

const exists=async(file:string)=>fs.lstat(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
interface InitialRescueOptions {v1UserData:string;v1Registry:string;recoveryRoot:string;v1ClaudeConfig?:string;assertStopped():Promise<void>}
interface InitialPreparation {schemaVersion:1;kind:'initial-rescue';v1UserData:string;v1Registry:string;userData:string;registry:string;backupDirectory:string;hostId:string;backupManifestSha256:string}
async function assertOwnedEmptyRoots(receipt:InitialPreparation){
 const inspect=async(directory:string,allowed:string[])=>{
  await requirePlainPath(directory,true);
  if(await exists(directory)){
   if(!(await fs.lstat(directory)).isDirectory()||(await fs.readdir(directory)).some(name=>!allowed.includes(name)))throw new Error('Unexplained v2 data prevents resuming initial rescue');
  }
 };
 await inspect(receipt.registry,[]);await inspect(receipt.userData,['host']);await inspect(path.join(receipt.userData,'host'),['identity.json']);
 const identity=path.join(receipt.userData,'host/identity.json');await requirePlainPath(identity,true);
 if(await exists(identity)){
  const value=JSON.parse(await fs.readFile(identity,'utf8'));
  if(Object.keys(value).join(',')!=='hostId'||value.hostId!==receipt.hostId)throw new Error('Unexplained recovery host identity prevents initial rescue');
 }
}
/** Explicit rescue only, never normal startup. A pre-Electron crash has no v2
 * host authority yet. Preserve originals before creating an empty recovery-only
 * host; do not migrate, start providers or infer remote exit from an empty host. */
export async function prepareInitialRescueData(options:InitialRescueOptions){
 const layout=getV2DataLayout(options),backupDirectory=path.join(layout.recoveryRoot,'v1-before-v2');
 for(const file of [options.v1UserData,options.v1Registry,layout.recoveryRoot,layout.userData,layout.registry])await requirePlainPath(file,true);
 await options.assertStopped();
 const receiptPath=path.join(layout.recoveryRoot,'initial-rescue-preparation.json');await requirePlainPath(receiptPath,true);
 let receipt:InitialPreparation|null=await exists(receiptPath)?JSON.parse(await fs.readFile(receiptPath,'utf8')):null;
 if(receipt){
  if(receipt.schemaVersion!==1||receipt.kind!=='initial-rescue'||receipt.v1UserData!==options.v1UserData||receipt.v1Registry!==options.v1Registry||receipt.userData!==layout.userData||receipt.registry!==layout.registry||receipt.backupDirectory!==backupDirectory||!/^[-\w]{1,128}$/.test(receipt.hostId)||!/^[a-f0-9]{64}$/.test(receipt.backupManifestSha256))throw new Error('Initial rescue preparation identity differs');
  await verifyV1Backup(backupDirectory);
  if((await fs.readFile(path.join(backupDirectory,'manifest.sha256'),'utf8')).trim()!==receipt.backupManifestSha256)throw new Error('Initial rescue original backup changed');
  await assertOwnedEmptyRoots(receipt);
 }else if(await exists(layout.userData)||await exists(layout.registry))throw new Error('Existing v2 state has no independent installation record; preserve it and inspect before recovery');
 const assertStopped=async()=>{
  await options.assertStopped();
  for(const filename of ['remote-hosts.json','host/host-connections.json']){
   const file=path.join(options.v1UserData,filename);await requirePlainPath(file,true);
   if(await exists(`${file}.bak`)&&!await exists(file))throw new Error('Remote work inventory primary is missing');
   if(await exists(file)){
    const value=JSON.parse(await fs.readFile(file,'utf8'));
    if(!Array.isArray(value?.hosts)||value.hosts.length)throw new Error('Unknown remote work blocks initial rescue; a live host inventory is required');
   }
  }
 };
 await assertStopped();
 await fs.mkdir(layout.recoveryRoot,{recursive:true,mode:0o700});
 if(await exists(backupDirectory)){
  const backup=await verifyV1Backup(backupDirectory);
  if(path.resolve(backup.sources.userData)!==path.resolve(options.v1UserData)||path.resolve(backup.sources.registry)!==path.resolve(options.v1Registry))throw new Error('Original backup paths differ');
 }else{
  await fs.mkdir(options.v1UserData,{recursive:true});await fs.mkdir(options.v1Registry,{recursive:true});
  await createV1Backup({destination:backupDirectory,sources:{userData:options.v1UserData,registry:options.v1Registry},assertStopped});
 }
 if(options.v1ClaudeConfig){
  const destination=path.join(layout.recoveryRoot,'v1-mods-before-v2');
  if(await exists(destination))await verifyModBackup(destination);
  else await createModBackup({destination,sources:await discoverV1ModSources(options.v1ClaudeConfig),assertStopped});
 }
 await verifyV1Backup(backupDirectory);await assertStopped();
 if(!receipt){
  receipt={schemaVersion:1,kind:'initial-rescue',v1UserData:options.v1UserData,v1Registry:options.v1Registry,userData:layout.userData,registry:layout.registry,backupDirectory,hostId:randomUUID(),backupManifestSha256:(await fs.readFile(path.join(backupDirectory,'manifest.sha256'),'utf8')).trim()};
  // Synced provenance exists before either final root or the host identity. A
  // retry can resume only this exact empty recovery-owned footprint.
  await writeRecoveryState(receiptPath,receipt);
 }
 await assertOwnedEmptyRoots(receipt);await assertStopped();
 await fs.mkdir(layout.registry,{recursive:true,mode:0o700});
 await fs.mkdir(path.join(layout.userData,'host'),{recursive:true,mode:0o700});
 const identity=path.join(layout.userData,'host/identity.json');
 if(!await exists(identity))await fs.writeFile(identity,JSON.stringify({hostId:receipt.hostId}),{flag:'wx',mode:0o600,flush:true});
 await assertOwnedEmptyRoots(receipt);
 return {...layout,backupDirectory,hostId:receipt.hostId};
}
