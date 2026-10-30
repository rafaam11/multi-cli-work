import {readHostDescriptor} from '../host/host-process';
import {HostClient} from '../host/host-client';
import {readProcessInventory,type ProcessIdentity} from '../herdr/process-observation';
import {openOfflineRecoveryHost} from './offline-host';
import type {RecoveryClient} from './work-session';
import type {LocalProcessProofOptions} from './local-process-proof';

export interface LocalRecoveryAuthority {client:RecoveryClient;offline:boolean;process?:ProcessIdentity;close():Promise<void>}
export async function openLocalRecoveryAuthority(options:LocalProcessProofOptions):Promise<LocalRecoveryAuthority>{
  const descriptor=await readHostDescriptor(options.directory);
  if(descriptor){
    if(descriptor.hostId!==options.hostId)throw new Error('Local host identity differs');
    const client=new HostClient(descriptor);let available=false;
    try{const health=await client.health();available=health.schemaVersion===2&&health.hostId===options.hostId;}catch{/* No dispatch; native proof and the daemon lock decide offline authority. */}
    if(available){
      const inventory=await (options.inventory??(()=>readProcessInventory(options.bridgePath)))(),identity=inventory.find(item=>item.pid===descriptor.pid);
      if(!identity?.startId)throw new Error('Local host process cannot be identified');
      return {client,offline:false,process:identity,close:async()=>{}};
    }
  }
  const client=await openOfflineRecoveryHost(options);return {client,offline:true,close:()=>client.close()};
}
