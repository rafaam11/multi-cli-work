import path from 'node:path';
import {readProcessInventory,parseProcessInventory,observeProcessTree,type ProcessIdentity} from '../herdr/process-observation';
import {readRecoveryJson} from '../recovery/local-process-proof';
import {writeRecoveryState} from '../recovery/controller-state';

/** Called while holding mcw-host-runtime, before accepting or preparing work. */
export async function recordHostProcessIdentity(directory:string,hostId:string,bridgePath:string,inventory:()=>Promise<ProcessIdentity[]>=()=>readProcessInventory(bridgePath)):Promise<void>{
  const processes=await inventory(),self=processes.find(item=>item.pid===process.pid);
  if(!self?.startId)throw new Error('Host kernel process identity unavailable');
  const filename=path.join(directory,'host-process-identity.json'),previous=await readRecoveryJson(filename);
  if(previous!==null){
    if(previous.schemaVersion!==1||previous.hostId!==hostId||!previous.process)throw new Error('Host process identity differs');
    const known=parseProcessInventory([previous.process]);
    if(!known[0].startId||observeProcessTree(known,processes).status!=='exited')throw new Error('Previous host may still be running; it was not replaced');
  }
  await writeRecoveryState(filename,{schemaVersion:1,hostId,process:self});
}
