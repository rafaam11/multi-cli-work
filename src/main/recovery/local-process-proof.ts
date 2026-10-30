import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {readProcessInventory,parseProcessInventory,observeProcessTree,type ProcessIdentity} from '../herdr/process-observation';
import {parseHerdrSessionRegistry,type ManagedSession} from '../herdr/terminal-service';
import {requirePlainPath} from './controller-state';
import {findRecoveryProcesses} from './residual-processes';

export interface LocalProcessProofOptions {
  directory:string;hostId:string;bridgePath:string;runtimePaths:string[];
  guiProcess?:ProcessIdentity|null;hostProcess?:ProcessIdentity;includeGui?:boolean;
  inventory?:()=>Promise<ProcessIdentity[]>;
}
export async function readRecoveryJson(filename:string):Promise<any|null>{
  await requirePlainPath(filename,true);
  try{return JSON.parse(await readFile(filename,'utf8'));}
  catch(error){
    if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    // A missing primary with a surviving backup is not evidence of no work.
    try{await lstat(`${filename}.bak`);}catch(backupError){if((backupError as NodeJS.ErrnoException).code==='ENOENT')return null;throw backupError;}
    throw new Error('Recovery process primary is missing; its backup cannot prove exit');
  }
}
/** Native birth identity, not a pane status or PID alone, proves process exit. */
export async function proveLocalProcessesStopped(options:LocalProcessProofOptions):Promise<ManagedSession[]>{
  await requirePlainPath(options.directory);
  const processes=await (options.inventory??(()=>readProcessInventory(options.bridgePath)))();
  const stored=await readRecoveryJson(path.join(options.directory,'host-process-identity.json'));
  let host:ProcessIdentity|undefined=options.hostProcess;
  if(stored!==null){
    if(stored.schemaVersion!==1||stored.hostId!==options.hostId||!stored.process)throw new Error('Host process identity differs');
    host=parseProcessInventory([stored.process])[0];if(!host.startId)throw new Error('Host process identity is unavailable');
  }else{
    const descriptor=await readRecoveryJson(path.join(options.directory,'mcw-host.json'));
    if(descriptor!==null){
      if(descriptor.schemaVersion!==2||descriptor.hostId!==options.hostId||!Number.isSafeInteger(descriptor.pid)||descriptor.pid<=0)throw new Error('Host descriptor identity differs');
      if(!host&&processes.some(item=>item.pid===descriptor.pid))throw new Error('Legacy host process may still be running; its birth identity is missing');
    }
  }
  for(const identity of [host,options.hostProcess,options.includeGui?options.guiProcess:null])if(identity&&observeProcessTree([identity],processes).status!=='exited')throw new Error('MCW GUI or host is still running or unobserved');
  const residual=findRecoveryProcesses(processes,{applicationNames:options.includeGui?['Multi CLI Work.exe','Multi CLI Work Preview.exe','multi-cli-work','multi-cli-work-preview']:[],runtimePaths:options.runtimePaths,trackedPids:[]},process.platform).filter(item=>item.pid!==process.pid);
  if(residual.length)throw new Error(`Other MCW runtime instances remain (${residual.map(item=>item.pid).join(', ')}); no process was terminated`);
  const runtime=await readRecoveryJson(path.join(options.directory,'herdr/runtime-processes.json'));
  if(runtime!==null){const identities=parseProcessInventory(runtime);if(identities.length&&observeProcessTree(identities,processes).status!=='exited')throw new Error('Herdr process exit is not confirmed');}
  const registry=await readRecoveryJson(path.join(options.directory,'terminal-sessions.json'));
  const sessions=registry===null?[]:parseHerdrSessionRegistry(registry).sessions;
  for(const terminal of sessions){
    if(terminal.processes?.length){if(observeProcessTree(terminal.processes,processes).status!=='exited')throw new Error('A terminal process remains or is unobserved');}
    else if(terminal.delivery!=='rejected')throw new Error('A terminal process identity is missing');
  }
  return sessions;
}
