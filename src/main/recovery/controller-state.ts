import {open,readFile,rename,rm,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import lockfile from 'proper-lockfile';
import type {CoordinateRollbackOptions,RecoveryHostObservation,RecoveryPhase} from '../../shared/recovery-types';
import {observeProcessTree,type ProcessIdentity} from '../herdr/process-observation';
import {findRecoveryProcesses} from './residual-processes';
import type {RecoveryScope} from './work-session';
import {validateV1ProviderEnvironment} from './v1-launch';

export type {RecoveryPhase};
export interface RecoveryOperationState {
  schemaVersion:1;operationId:string;phase:RecoveryPhase;updatedAt:number;
  scopes:RecoveryScope[];observations:RecoveryHostObservation[];controllerProcess?:ProcessIdentity;launchedV1?:ProcessIdentity;error?:string;failedAtPhase?:RecoveryPhase;
}
export interface RecoveryRequest extends Omit<CoordinateRollbackOptions,'adapter'> {
  schemaVersion:1;operationId:string;operationDirectory:string;localHostId:string;hostDirectory:string;
  bridgePath:string;guiProcess:ProcessIdentity|null;runtimePaths:string[];
  installDirectory:string;executablePath:string;updaterCaches:{cacheRoot:string;cacheName:string}[];
  v1ProviderEnvironment?:Record<string,string>;
}
export interface RecoveryInstallation extends Omit<RecoveryRequest,'operationId'|'operationDirectory'|'destination'|'expectedHostIds'|'guiProcess'> {recoveryRoot:string;packaged:true}
export async function acquireRecoveryStart(root:string):Promise<()=>Promise<void>>{
  await requirePlainPath(root);
  return lockfile.lock(path.join(root,'recovery-operation-start'),{realpath:false,retries:0,stale:300000,update:5000});
}
export function recoveryControllerRunning(state:Pick<RecoveryOperationState,'controllerProcess'>,inventory:ProcessIdentity[],executable:string,callerPid:number):boolean{
  if(state.controllerProcess)return observeProcessTree([state.controllerProcess],inventory).status!=='exited';
  // A child can be alive between spawn and the first synced state. A cancel
  // command in that window signals it; it must not impersonate a dead controller.
  return findRecoveryProcesses(inventory,{applicationNames:[],runtimePaths:[executable],trackedPids:[]},process.platform).some(item=>item.pid!==callerPid);
}
/** The operation journal is separate from both app-data generations. Sync its
 * replacement before dispatching any mutating request or installer. */
export async function writeRecoveryState(filename:string,value:unknown):Promise<void>{
  const temporary=`${filename}.${randomUUID()}.tmp`,file=await open(temporary,'wx',0o600);
  try{await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();}finally{await file.close();}
  try{await rename(temporary,filename);}finally{await rm(temporary,{force:true});}
}
export async function readRecoveryState(directory:string):Promise<RecoveryOperationState|null>{
  try{
    const value=JSON.parse(await readFile(path.join(directory,'state.json'),'utf8')) as RecoveryOperationState;
    if(value.schemaVersion!==1||!['starting','holding','waiting-work','waiting-gui','stopping-host','preserving','installing','verifying-install','clearing-updater','launching','complete','cancelled','failed'].includes(value.phase)||!Array.isArray(value.scopes)||!Array.isArray(value.observations))throw new Error('Invalid recovery operation state');
    return value;
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
export async function requirePlainPath(filename:string,missing=false):Promise<void>{
  if(!path.isAbsolute(filename)||/[\x00-\x1f]/.test(filename))throw new Error('Absolute recovery path required');
  const same=(a:string,b:string)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
  for(let current=path.resolve(filename);;current=path.dirname(current)){
    const info=await lstat(current,{bigint:true}).catch(error=>{if(missing&&(error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
    if(info){
      if(info.isSymbolicLink())throw new Error('Recovery path contains a link');
      const resolved=await realpath(current);
      if(!same(resolved,current)){
        // NTFS 8.3 aliases change spelling without redirecting the file. Check
        // kernel file identity and still inspect every lexical ancestor below.
        const target=await lstat(resolved,{bigint:true});
        if(process.platform!=='win32'||info.ino===0n||info.dev!==target.dev||info.ino!==target.ino||target.isSymbolicLink())throw new Error('Recovery path contains a link');
      }
    }
    if(path.dirname(current)===current)break;
  }
}
export function validateRecoveryRequest(value:unknown):asserts value is RecoveryRequest{
  const request=value as RecoveryRequest;
  if(request?.v1ProviderEnvironment!==undefined)validateV1ProviderEnvironment(request.v1ProviderEnvironment);
  if(!request||request.schemaVersion!==1||!/^[-\w]{1,128}$/.test(request.operationId)||!/^[-\w]{1,128}$/.test(request.localHostId)||!['win32','deb','appimage'].includes(request.platform)||!Array.isArray(request.expectedHostIds)||!request.expectedHostIds.includes(request.localHostId)||!Array.isArray(request.runtimePaths)||!request.runtimePaths.length||!Array.isArray(request.updaterCaches))throw new Error('Invalid recovery request');
  const files=[request.operationDirectory,request.backupDirectory,request.destination,request.assetsDirectory,request.installDirectory,request.executablePath,request.hostDirectory,request.bridgePath,request.targets?.userData,request.targets?.registry,request.preserveV2Sources?.userData,request.preserveV2Sources?.registry,...request.runtimePaths,...request.updaterCaches.map(cache=>cache.cacheRoot),...(request.sharedConfigJournals??[])];
  if(files.some(file=>typeof file!=='string'||!path.isAbsolute(file)||/[\x00-\x1f]/.test(file))||path.basename(request.operationDirectory)!==request.operationId||path.resolve(request.destination)!==path.join(request.operationDirectory,'prepared')||path.resolve(request.hostDirectory)!==path.join(request.preserveV2Sources.userData,'host')||path.resolve(request.bridgePath)!==path.join(request.assetsDirectory,process.platform==='win32'?'recovery-process-bridge.exe':'recovery-process-bridge'))throw new Error('Recovery request paths differ');
  if((request.platform==='win32')!==(process.platform==='win32')||(process.platform!=='win32'&&process.platform!=='linux'))throw new Error('Recovery platform differs');
  if(request.guiProcess!==null&&(!request.guiProcess||!Number.isSafeInteger(request.guiProcess.pid)||request.guiProcess.pid<=0||typeof request.guiProcess.startId!=='string'||!request.guiProcess.startId))throw new Error('GUI process identity unavailable');
}
