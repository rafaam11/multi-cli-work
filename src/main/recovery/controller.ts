import {readFile,open,rm,lstat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {extractFile} from '@electron/asar';
import {connectSshHost,validateSshHostConfiguration} from '../host/ssh-host';
import type {HostRegistration} from '../../shared/host-connection-types';
import type {RollbackLifecycleAdapter,RecoveryHostObservation} from '../../shared/recovery-types';
import {readProcessInventory,observeProcessTree} from '../herdr/process-observation';
import {findRecoveryProcesses,MCW_GUI_PROCESS_NAMES} from './residual-processes';
import {RecoveryWorkHolds} from './work-holds';
import {RecoveryWorkSession} from './work-session';
import {openLocalRecoveryAuthority} from './local-authority';
import {proveLocalProcessesStopped} from './local-process-proof';
import {v1LaunchEnvironment,observeV1Launch} from './v1-launch';
import {quarantineUpdaterCache} from './updater-cache';
import {assertRollbackHosts,coordinateRollback,verifyRecoveryAssets,verifyV1Backup,installOriginalV1,ORIGINAL_INSTALLERS,getV2DataLayout} from './index';
import {readRecoveryState,writeRecoveryState,requirePlainPath,validateRecoveryRequest,type RecoveryRequest,type RecoveryOperationState,type RecoveryPhase} from './controller-state';

class RecoveryCancelled extends Error {}
const missing=(error:unknown)=>(error as NodeJS.ErrnoException).code==='ENOENT';
async function optionalJson(filename:string):Promise<any|null>{try{return JSON.parse(await readFile(filename,'utf8'));}catch(error){if(missing(error))return null;throw error;}}
/** Runs in the preserved standalone Node. No Electron imports, host launch,
 * work termination, command replay, Git operations or automatic takeover. */
export async function createAdapter(request:RecoveryRequest,forCancellation=false):Promise<RollbackLifecycleAdapter&{close():Promise<void>;cancel():Promise<void>;state():RecoveryOperationState}>{
  validateRecoveryRequest(request);
  for(const file of [request.operationDirectory,request.assetsDirectory,request.backupDirectory,request.hostDirectory,request.bridgePath])await requirePlainPath(file);
  const backup=await verifyV1Backup(request.backupDirectory);
  if(path.resolve(backup.sources.userData)!==path.resolve(request.targets.userData)||path.resolve(backup.sources.registry)!==path.resolve(request.targets.registry))throw new Error('Recovery targets differ from the original backup');
  const layout=getV2DataLayout({v1UserData:request.targets.userData,v1Registry:request.targets.registry,recoveryRoot:path.dirname(request.backupDirectory)});
  if(layout.userData!==request.preserveV2Sources.userData||layout.registry!==request.preserveV2Sources.registry)throw new Error('V2 preservation roots differ');
  const assets=await verifyRecoveryAssets(request.assetsDirectory,request.platform);
  for(const filename of ['recovery-controller.cjs',path.basename(request.bridgePath)])if(!assets.manifest.assets.some(asset=>asset.filename===filename))throw new Error('Independent recovery controller is missing');
  const stateFile=path.join(request.operationDirectory,'state.json');
  let state=await readRecoveryState(request.operationDirectory)??{schemaVersion:1,operationId:request.operationId,phase:'starting',updatedAt:Date.now(),scopes:[],observations:[]} as RecoveryOperationState;
  if(state.operationId!==request.operationId)throw new Error('Recovery operation identity differs');
  const inventory=await readProcessInventory(request.bridgePath),self=inventory.find(item=>item.pid===process.pid);
  if(!self?.startId)throw new Error('Recovery controller process cannot be identified');
  if(state.controllerProcess&&observeProcessTree([state.controllerProcess],inventory).status!=='exited')throw new Error('Another recovery controller is still running');
  if(!forCancellation&&state.phase!=='starting')throw new Error('This recovery was already attempted; inspect its journal or cancel its holds');
  state={...state,controllerProcess:self};
  const update=async(phase:RecoveryPhase,patch:Partial<RecoveryOperationState>={})=>{state={...state,...patch,phase,updatedAt:Date.now()};await writeRecoveryState(stateFile,state);};
  await update(state.phase);
  const connections=new Map<string,Awaited<ReturnType<typeof connectSshHost>>>();
  const proofOptions={directory:request.hostDirectory,hostId:request.localHostId,bridgePath:request.bridgePath,runtimePaths:request.runtimePaths};
  let authority=await openLocalRecoveryAuthority(proofOptions);
  const local=authority.client;
  let stopped=false;
  const connect=async(hostId:string)=>{
    if(hostId===request.localHostId)return local;
    const existing=connections.get(hostId);if(existing)return existing.client;
    const registry=await optionalJson(path.join(request.hostDirectory,'host-connections.json'));
    if(registry?.version!==2||!Array.isArray(registry.hosts))throw new Error('Remote host registrations unavailable');
    const registration=(registry.hosts as HostRegistration[]).find(host=>host.ssh.hostId===hostId);
    if(!registration)throw new Error(`Related PC ${hostId} has no direct SSH registration`);
    validateSshHostConfiguration(registration.ssh);
    const connection=await connectSshHost(registration.ssh);connections.set(hostId,connection);return connection.client;
  };
  let work:RecoveryWorkSession;
  try{work=new RecoveryWorkSession({operationId:request.operationId,localHostId:request.localHostId,expectedHostIds:request.expectedHostIds,scopes:state.scopes,client:connect,save:async scopes=>update('holding',{scopes}),checkCancelled:()=>checkCancel()});}
  catch(error){await authority.close();throw error;}
  const assertNoInstances=async()=>{if(authority.offline)await authority.client.request('/health');await proveLocalProcessesStopped({...proofOptions,includeGui:true,guiProcess:request.guiProcess,hostProcess:authority.process});};
  const release=async()=>{
    let unavailable=false;try{await local.request('/health','GET',undefined,1000);}catch{unavailable=true;}
    await work.release(unavailable?async()=>{await assertNoInstances();const holds=new RecoveryWorkHolds(request.hostDirectory);if(await holds.get(request.operationId))await holds.release(request.operationId,request.localHostId);}:undefined);
  };
  const checkCancel=async()=>{if(await lstat(path.join(request.operationDirectory,'cancel.json')).catch(error=>{if(missing(error))return null;throw error;}))throw new RecoveryCancelled('Recovery cancelled by the user');};
  const observeHosts=()=>work.observeHosts(stopped?assertNoInstances:undefined);
  return {
    state:()=>structuredClone(state),
    close:async()=>{try{await Promise.all([...connections.values()].map(connection=>connection.close()));}finally{await authority.close();}},
    cancel:async()=>{await release();await update('cancelled');},
    stopNewWork:async()=>{
      await checkCancel();await work.stopNewWork();
      for(;;){
        await checkCancel();const observations=await observeHosts();await update('waiting-work',{observations});
        try{assertRollbackHosts({hosts:observations,expectedHostIds:request.expectedHostIds});break;}catch{await delay(1000);}
      }
    },
    observeHosts,
    gracefulStop:async()=>{
      await update('waiting-gui');
      for(;;){
        await checkCancel();const processes=await readProcessInventory(request.bridgePath);
        const guiPaths=request.runtimePaths.filter(file=>MCW_GUI_PROCESS_NAMES.some(name=>name.toLowerCase()===path.basename(file).toLowerCase()));
        const apps=findRecoveryProcesses(processes,{applicationNames:MCW_GUI_PROCESS_NAMES,runtimePaths:[request.executablePath,...guiPaths],trackedPids:[]},process.platform);
        if((!request.guiProcess||observeProcessTree([request.guiProcess],processes).status==='exited')&&apps.length===0)break;
        await delay(1000);
      }
      // Recheck remote work after the user-facing GUI has closed.
      assertRollbackHosts({hosts:await observeHosts(),expectedHostIds:request.expectedHostIds});
      await checkCancel();await update('stopping-host');
      if(!authority.offline)try{await local.request('/shutdown','POST');}catch{/* Unknown reply is settled only through kernel observation below. */}
      const deadline=Date.now()+30000;let lastError:unknown;
      do{try{
        await assertNoInstances();
        if(!authority.offline){
          const next=await openLocalRecoveryAuthority(proofOptions);
          if(!next.offline){await next.close();throw new Error('Host restarted during recovery; shutdown was not retried');}
          authority=next;
        }
        await assertNoInstances();stopped=true;await update('preserving');return;
      }catch(error){lastError=error;await delay(250);}}while(Date.now()<deadline);
      throw new Error('Host shutdown could not be confirmed; it was not retried',{cause:lastError});
    },
    assertNoInstances,
    installOriginal:async()=>{await update('installing');await installOriginalV1({assetsDirectory:request.assetsDirectory,platform:request.platform,installDirectory:request.installDirectory});},
    verifyInstalledVersion:async()=>{
      await update('verifying-install');await requirePlainPath(request.executablePath);
      if(request.platform==='appimage')return createHash('sha256').update(await readFile(request.executablePath)).digest('hex')===ORIGINAL_INSTALLERS.appimage.sha256?'1.55.1':'';
      const archive=path.join(request.installDirectory,'resources/app.asar');await requirePlainPath(archive);
      const metadata=JSON.parse(extractFile(archive,'package.json').toString('utf8'));
      return metadata.name==='multi-cli-work'?metadata.version:'';
    },
    clearPendingUpdaterState:async()=>{await update('clearing-updater');for(const cache of request.updaterCaches)await quarantineUpdaterCache({...cache,assertStopped:assertNoInstances});},
    launchV1:async()=>{
      // Released receipts stay in the preserved v2 tree; replaying any task is
      // still an explicit action. The immutable pre-release copy stays intact.
      await release();await update('launching');
      const environment=v1LaunchEnvironment(process.env,request.targets,request.v1ProviderEnvironment);
      const child=spawn(request.executablePath,[],{cwd:path.dirname(request.executablePath),detached:true,windowsHide:true,stdio:'ignore',env:environment});
      await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
      const launchedV1=await observeV1Launch(child,()=>readProcessInventory(request.bridgePath));
      await update('complete',{launchedV1});
    },
  };
}

export async function runRecovery(request:RecoveryRequest):Promise<void>{
  validateRecoveryRequest(request);await requirePlainPath(request.operationDirectory);
  const lock=await open(path.join(request.operationDirectory,'run.lock'),'wx',0o600);await lock.close();
  let adapter:Awaited<ReturnType<typeof createAdapter>>|undefined;
  try{adapter=await createAdapter(request);await coordinateRollback({...request,adapter});}
  catch(error){
    let failure=error;
    if(error instanceof RecoveryCancelled&&adapter){try{await adapter.cancel();return;}catch(cancelError){failure=cancelError;}}
    const state=adapter?.state()??await readRecoveryState(request.operationDirectory);
    if(state)await writeRecoveryState(path.join(request.operationDirectory,'state.json'),{...state,phase:'failed',failedAtPhase:state.phase,updatedAt:Date.now(),error:failure instanceof Error?failure.message:'Recovery failed'});
    throw failure;
  }finally{await adapter?.close();await rm(path.join(request.operationDirectory,'run.lock'),{force:true});}
}
