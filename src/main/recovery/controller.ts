import {readFile,open,rm,lstat} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {extractFile} from '@electron/asar';
import {HostClient} from '../host/host-client';
import {readHostDescriptor} from '../host/host-process';
import {connectSshHost,validateSshHostConfiguration} from '../host/ssh-host';
import type {HostRegistration} from '../../shared/host-connection-types';
import type {RollbackLifecycleAdapter,RecoveryHostObservation} from '../../shared/recovery-types';
import {readProcessInventory,observeProcessTree,parseProcessInventory,type ProcessIdentity} from '../herdr/process-observation';
import {findRecoveryProcesses} from './residual-processes';
import {RecoveryWorkHolds} from './work-holds';
import {RecoveryWorkSession} from './work-session';
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
  let local:HostClient|undefined,hostProcess:ProcessIdentity|undefined,stopped=false;
  const descriptor=await readHostDescriptor(request.hostDirectory);
  if(descriptor){
    if(descriptor.hostId!==request.localHostId)throw new Error('Local host identity differs');
    local=new HostClient(descriptor);hostProcess=inventory.find(item=>item.pid===descriptor.pid);
    if(!forCancellation&&!hostProcess?.startId)throw new Error('Local host process cannot be identified');
  }else if(!forCancellation)throw new Error('Local host is unavailable; recovery is blocked until its work can be observed');
  const connect=async(hostId:string)=>{
    if(hostId===request.localHostId){if(!local)throw new Error('Local host unavailable');return local;}
    const existing=connections.get(hostId);if(existing)return existing.client;
    const registry=await optionalJson(path.join(request.hostDirectory,'host-connections.json'));
    if(registry?.version!==2||!Array.isArray(registry.hosts))throw new Error('Remote host registrations unavailable');
    const registration=(registry.hosts as HostRegistration[]).find(host=>host.ssh.hostId===hostId);
    if(!registration)throw new Error(`Related PC ${hostId} has no direct SSH registration`);
    validateSshHostConfiguration(registration.ssh);
    const connection=await connectSshHost(registration.ssh);connections.set(hostId,connection);return connection.client;
  };
  const work=new RecoveryWorkSession({operationId:request.operationId,localHostId:request.localHostId,expectedHostIds:request.expectedHostIds,scopes:state.scopes,client:connect,save:async scopes=>update('holding',{scopes}),checkCancelled:()=>checkCancel()});
  const assertNoInstances=async()=>{
    const processes=await readProcessInventory(request.bridgePath);
    for(const identity of [request.guiProcess,hostProcess])if(identity&&observeProcessTree([identity],processes).status!=='exited')throw new Error('MCW GUI or host is still running or unobserved');
    const residual=findRecoveryProcesses(processes,{applicationNames:['Multi CLI Work.exe','Multi CLI Work Preview.exe','multi-cli-work','multi-cli-work-preview'],runtimePaths:request.runtimePaths,trackedPids:[]},process.platform).filter(item=>item.pid!==process.pid);
    if(residual.length)throw new Error(`Other MCW instances remain (${residual.map(item=>item.pid).join(', ')}); no process was terminated`);
    const runtime=await optionalJson(path.join(request.hostDirectory,'herdr/runtime-processes.json'));
    if(runtime!==null){const identities=parseProcessInventory(runtime);if(identities.length&&observeProcessTree(identities,processes).status!=='exited')throw new Error('Herdr process exit is not confirmed');}
    const terminals=await optionalJson(path.join(request.hostDirectory,'terminal-sessions.json'));
    if(terminals!==null){
      if(terminals.version!==2||!Array.isArray(terminals.sessions))throw new Error('Terminal process inventory unavailable');
      for(const terminal of terminals.sessions){
        if(terminal.processes?.length){if(observeProcessTree(parseProcessInventory(terminal.processes),processes).status!=='exited')throw new Error('A terminal process remains or is unobserved');}
        else if(terminal.delivery!=='rejected'&&terminal.delivery!=='none')throw new Error('A terminal process identity is missing');
      }
    }
  };
  const release=async()=>{
    let offline=false;try{await local?.health();offline=!local;}catch{offline=true;}
    await work.release(offline?async()=>{await assertNoInstances();const holds=new RecoveryWorkHolds(request.hostDirectory);if(await holds.get(request.operationId))await holds.release(request.operationId,request.localHostId);}:undefined);
  };
  const checkCancel=async()=>{if(await lstat(path.join(request.operationDirectory,'cancel.json')).catch(error=>{if(missing(error))return null;throw error;}))throw new RecoveryCancelled('Recovery cancelled by the user');};
  const observeHosts=()=>work.observeHosts(stopped?assertNoInstances:undefined);
  return {
    state:()=>structuredClone(state),
    close:async()=>{await Promise.all([...connections.values()].map(connection=>connection.close()));},
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
        const apps=findRecoveryProcesses(processes,{applicationNames:['Multi CLI Work.exe','Multi CLI Work Preview.exe','multi-cli-work','multi-cli-work-preview'],runtimePaths:[request.executablePath],trackedPids:[]},process.platform);
        if((!request.guiProcess||observeProcessTree([request.guiProcess],processes).status==='exited')&&apps.length===0)break;
        await delay(1000);
      }
      // Recheck remote work after the user-facing GUI has closed.
      assertRollbackHosts({hosts:await observeHosts(),expectedHostIds:request.expectedHostIds});
      await checkCancel();await update('stopping-host');
      try{await local!.shutdown();}catch{/* Unknown reply is settled only through kernel observation below. */}
      const deadline=Date.now()+30000;let lastError:unknown;
      do{try{await assertNoInstances();stopped=true;await update('preserving');return;}catch(error){lastError=error;await delay(250);}}while(Date.now()<deadline);
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
      const environment={...process.env};for(const key of Object.keys(environment))if(key.startsWith('MCW_')||key.startsWith('MULTI_CLI_WORK_')||key==='ELECTRON_RUN_AS_NODE')delete environment[key];
      environment.MULTI_CLI_WORK_USER_DATA=request.targets.userData;
      for(const [key,file] of Object.entries({MULTI_CLI_WORK_REGISTRY_PATH:'projects.json',MULTI_CLI_WORK_WORK_PROJECTS_PATH:'work-projects.json',MULTI_CLI_WORK_WORKSPACE_PATH:'workspace.json',MULTI_CLI_WORK_PROJECT_TAGS_PATH:'project-tags.json',MULTI_CLI_WORK_AGENTS_PATH:'agents.json',MULTI_CLI_WORK_WORKTREES_PATH:'worktrees.json',MULTI_CLI_WORK_SESSION_PRESETS_PATH:'session-presets.json',MULTI_CLI_WORK_PR_REVIEWS_PATH:'pr-reviews.json',MULTI_CLI_WORK_WORKTREE_SCRIPTS_PATH:'worktree-scripts.json'}))environment[key]=path.join(request.targets.registry,file);
      const child=spawn(request.executablePath,[],{cwd:path.dirname(request.executablePath),detached:true,windowsHide:true,stdio:'ignore',env:environment});
      await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();await update('complete');
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
