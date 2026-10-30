import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {RemoteAccess} from '../remote/remote-access';
import {RemoteDeviceStore} from '../remote/device-store';
import {PairingCodes} from '../remote/pairing-codes';
import {tailscaleAddresses} from '../remote/tailscale-address';
import {readShellArtifact} from '../remote/shell-artifact';
import {parseSettings,type RemoteSettings} from '../../shared/settings-types';
import type {RemoteAccessStatus,RemoteDeviceInfo,RemotePairingCode} from '../../shared/remote-types';
import type {V2HostState} from '../../shared/v2-api';
import {HostClient} from './host-client';
import {HostMobileHub} from './mobile-hub';
import {MobileAttentionStore} from '../remote/mobile-attention-store';

export interface HostMobileConfig {userData:string;rendererDir:string;shellDirectory?:string;bindOverride?:string}
export async function createHostMobileAccess(client:HostClient,hostId:string,config:HostMobileConfig):Promise<RemoteAccess>{
  if(!config||[config.userData,config.rendererDir].some(value=>typeof value!=='string'||!path.isAbsolute(value))||(config.shellDirectory!==undefined&&!path.isAbsolute(config.shellDirectory)))throw new Error('Invalid mobile resources');
  // This v2 data copy retains the original host fingerprint and token hashes.
  const devices=new RemoteDeviceStore(path.join(config.userData,'remote-devices.json'));
  const shell=config.shellDirectory?await readShellArtifact(config.shellDirectory):null;
  const hub=new HostMobileHub({client,devices,hostId,hostName:os.hostname(),catalog:()=>client.request('/execution-catalog'),attention:new MobileAttentionStore(path.join(config.userData,'mobile-attention.json')),shellLatest:()=>shell?.release??null,snapshot:async()=>{
    const [tasks,terminals,{observations:hosts}]=await Promise.all([client.tasks(),client.terminals(),client.request<{observations:V2HostState['hosts']}>('/hosts')]);
    return {tasks,terminals:terminals as V2HostState['terminals'],hosts,connected:true,observedAt:Date.now()};
  }});
  const access=new RemoteAccess({hub,devices,pairing:new PairingCodes(),rendererDir:config.rendererDir,mobileEntry:'mobile-v2.html',hostName:os.hostname(),bindOverride:config.bindOverride??null,addresses:()=>tailscaleAddresses(os.networkInterfaces()),shell});
  try{
    const contents=await fs.readFile(path.join(config.userData,'settings.json'),'utf8').catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return '{}';throw error;});
    await access.apply(parseSettings(JSON.parse(contents)).remote);return access;
  }catch(error){await access.dispose();throw error;}
}

/** GUI lifetime never owns or closes the phone gateway. */
export function mobileAccessProxy(client:HostClient){
  return {
    status:()=>client.request<RemoteAccessStatus>('/mobile/status'),
    apply:(settings:RemoteSettings)=>client.request<RemoteAccessStatus>('/mobile/settings','POST',settings),
    issuePairingCode:()=>client.request<RemotePairingCode>('/mobile/pairing','POST',{}),
    listDevices:()=>client.request<RemoteDeviceInfo[]>('/mobile/devices'),
    revokeDevice:(deviceId:string)=>client.request<void>(`/mobile/devices/${encodeURIComponent(deviceId)}`,'DELETE'),
    dispose:async()=>{},
  };
}
