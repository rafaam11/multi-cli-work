import path from "node:path";
import { EventEmitter } from "node:events";
import type { HostRegistration, RemoteHostObservation } from "../../shared/host-connection-types";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../storage/json-store";
import { parseHerdrSessionRegistry } from "../herdr/terminal-service";
import { validateTaskSnapshot } from "./task-validation";
import { connectSshHost, validateSshHostConfiguration } from "./ssh-host";
import type { HostTerminalSocket } from "./host-client";
import {observationCacheSpec,type CachedHostObservation} from "./observation-cache";

class ConnectionRegistryError extends Error {}
interface Registry {version:2;hosts:HostRegistration[]}
interface Slot {
  registration:HostRegistration;state:RemoteHostObservation;epoch:number;
  observedPlatform:"win32"|"linux";
  controller?:AbortController;
  connection?:Awaited<ReturnType<typeof connectSshHost>>;watcher?:HostTerminalSocket;retry?:ReturnType<typeof setTimeout>;
}
export interface HostConnectionsOptions {directory:string;localHostId:string;connect?:typeof connectSshHost;retryMs?:number}
/** Lives in mcw-host. GUI lifetime never owns these links or the remote processes. */
export class HostConnections {
  private readonly file:string;
  private readonly cacheFile:string;
  private cacheTimer?:ReturnType<typeof setTimeout>;
  private cacheWrites=Promise.resolve();
  private cacheWarning:string|null=null;
  private cacheReady=false;
  private readonly changes=new EventEmitter();
  private readonly slots=new Map<string,Slot>();
  private closed=false;
  private readonly pending=new Set<Promise<unknown>>();
  private readonly spec:JsonStoreSpec<Registry>;
  constructor(private readonly options:HostConnectionsOptions){
    this.file=path.join(options.directory,"host-connections.json");
    this.cacheFile=path.join(options.directory,"host-observations.json");
    this.spec={label:"host connections",displayName:"v2 호스트 연결",empty:()=>({version:2,hosts:[]}),parse:(value)=>{
      const data=value as Registry;
      if(!data||data.version!==2||!Array.isArray(data.hosts)||data.hosts.length>32||Object.keys(data).some(key=>!["version","hosts"].includes(key)))throw new ConnectionRegistryError("Invalid host connections");
      for(const host of data.hosts)this.validate(host);
      if(new Set(data.hosts.map(host=>host.ssh.hostId)).size!==data.hosts.length)throw new ConnectionRegistryError("Duplicate host identity");
      return data;
    },error:(message,options)=>new ConnectionRegistryError(message,options),isContentError:error=>error instanceof ConnectionRegistryError};
  }
  private validate(value:HostRegistration):void{
    try{
      if(!value||typeof value!=="object"||Object.keys(value).some(key=>!["name","ssh","enabled"].includes(key))||typeof value.name!=="string"||!value.name.trim()||value.name.length>100||/[\x00-\x1f]/.test(value.name)||typeof value.enabled!=="boolean")throw new Error("Invalid host registration");
      validateSshHostConfiguration(value.ssh);
      if(value.ssh.hostId===this.options.localHostId)throw new Error("Cannot connect to own host");
    }catch(error){throw new ConnectionRegistryError((error as Error).message);}
  }
  onChange(callback:()=>void):()=>void{this.changes.on("change",callback);return()=>this.changes.off("change",callback);}
  snapshot():RemoteHostObservation[]{return structuredClone([...this.slots.values()].map(slot=>slot.state));}
  registrations():HostRegistration[]{return structuredClone([...this.slots.values()].map(slot=>slot.registration));}
  client(hostId:string){const slot=this.slots.get(hostId);if(!slot?.state.connected||!slot.connection)throw new Error("Remote host is not observed");return slot.connection.client;}
  async start():Promise<void>{
    const stored=await readJsonStore(this.spec,this.file);
    if(!stored.writable)throw new Error(stored.warning??"Host registry is read only");
    let observations:CachedHostObservation[]=[];
    try{
      const cached=await readJsonStore(observationCacheSpec,this.cacheFile);observations=cached.value.observations;
      if(!cached.writable)this.cacheWarning="마지막 관찰 기록은 백업에서 읽었습니다. 기존 파일을 보존합니다.";
    }catch{this.cacheWarning="마지막 관찰 기록을 읽을 수 없습니다. 기존 파일을 보존합니다.";}
    for(const registration of stored.value.hosts)this.apply(registration,observations.find(item=>item.hostId===registration.ssh.hostId));
    this.cacheReady=true;
  }
  async configure(registration:HostRegistration):Promise<void>{
    if(this.closed)throw new Error("Host connections are closed");this.validate(registration);
    const saved=structuredClone(registration);
    await updateJsonStore(this.spec,this.file,current=>({version:2 as const,hosts:[...current.hosts.filter(host=>host.ssh.hostId!==saved.ssh.hostId),saved]}));
    if(!this.closed)this.apply(saved);
  }
  async remove(hostId:string):Promise<void>{
    if(this.closed)throw new Error("Host connections are closed");
    await updateJsonStore(this.spec,this.file,current=>({version:2 as const,hosts:current.hosts.filter(host=>host.ssh.hostId!==hostId)}));
    const slot=this.slots.get(hostId);if(slot)this.invalidate(slot);this.slots.delete(hostId);this.changes.emit("change");this.scheduleCache();
  }
  private invalidate(slot:Slot):Promise<void>{
    slot.epoch++;slot.controller?.abort();slot.controller=undefined;clearTimeout(slot.retry);slot.retry=undefined;slot.watcher?.close();slot.watcher=undefined;
    const connection=slot.connection;slot.connection=undefined;
    slot.state={...slot.state,connected:false,terminals:slot.state.terminals.map(terminal=>({...terminal,connected:false}))};
    return this.track(connection?.close().catch(()=>undefined)??Promise.resolve());
  }
  private track<T>(operation:Promise<T>):Promise<T>{this.pending.add(operation);void operation.finally(()=>this.pending.delete(operation)).catch(()=>undefined);return operation;}
  private apply(registration:HostRegistration,cached?:CachedHostObservation):void{
    const previous=this.slots.get(registration.ssh.hostId);if(previous)this.invalidate(previous);
    const slot:Slot={registration,epoch:0,observedPlatform:previous?.observedPlatform??cached?.platform??registration.ssh.platform,state:{hostId:registration.ssh.hostId,name:registration.name,enabled:registration.enabled,connected:false,observedAt:previous?.state.observedAt??cached?.observedAt??null,error:this.cacheWarning,tasks:previous?.state.tasks??cached?.tasks??[],terminals:(previous?.state.terminals??cached?.terminals??[]).map(terminal=>({...terminal,connected:false}))}};
    this.slots.set(registration.ssh.hostId,slot);this.changes.emit("change");
    if(registration.enabled)void this.track(this.connect(slot));
  }
  private current(slot:Slot,epoch:number):boolean{return !this.closed&&this.slots.get(slot.registration.ssh.hostId)===slot&&slot.epoch===epoch&&slot.registration.enabled;}
  private async connect(slot:Slot):Promise<void>{
    const epoch=++slot.epoch;
    const controller=new AbortController();slot.controller=controller;
    const lost=(message:string)=>{
      if(!this.current(slot,epoch))return;this.invalidate(slot);slot.state.error=message;this.changes.emit("change");
      slot.retry=setTimeout(()=>{slot.retry=undefined;if(!this.closed&&this.slots.get(slot.registration.ssh.hostId)===slot&&slot.registration.enabled)void this.track(this.connect(slot));},this.options.retryMs??3000);slot.retry.unref();
    };
    try{
      const connection=await (this.options.connect??connectSshHost)(slot.registration.ssh,{signal:controller.signal,onDisconnect:()=>lost("SSH 연결이 끊겼습니다.")});
      if(!this.current(slot,epoch)){await connection.close();return;}slot.connection=connection;
      slot.watcher=connection.client.watch(event=>{
        if(!this.current(slot,epoch)||!event||typeof event!=="object")return;
        const value=event as {type:string;tasks:unknown;terminals:unknown};
        if(value.type==="disconnected"){lost("호스트 관찰 연결이 끊겼습니다.");return;}
        if(value.type!=="state")return;
        try{
          const tasks=validateTaskSnapshot({schemaVersion:2,hostId:slot.state.hostId,tasks:value.tasks,outbox:[]}).tasks;
          const terminals=parseHerdrSessionRegistry({version:2,sessions:value.terminals},slot.registration.ssh.platform).sessions;
          slot.observedPlatform=slot.registration.ssh.platform;
          slot.state={...slot.state,tasks,terminals,connected:true,observedAt:Date.now(),error:this.cacheWarning};this.changes.emit("change");this.scheduleCache();
        }catch{lost("원격 호스트 상태 형식이 올바르지 않습니다.");}
      });
    }catch{lost("SSH 연결을 확인하세요. 호스트 키·계정·MCW 실행 상태를 확인한 뒤 다시 연결합니다.");}
  }
  private scheduleCache():void{
    if(this.closed||this.cacheTimer)return;
    this.cacheTimer=setTimeout(()=>{this.cacheTimer=undefined;void this.persistCache();},250);this.cacheTimer.unref();
  }
  private persistCache():Promise<void>{
    if(!this.cacheReady)return Promise.resolve();
    const observations=[...this.slots.values()].filter(slot=>slot.state.observedAt!==null).map(slot=>({hostId:slot.state.hostId,platform:slot.observedPlatform,observedAt:slot.state.observedAt!,tasks:slot.state.tasks,
      terminals:parseHerdrSessionRegistry({version:2,sessions:slot.state.terminals},slot.observedPlatform).sessions}));
    const snapshot=structuredClone(observations);
    this.cacheWrites=this.cacheWrites.then(async()=>{
      await updateJsonStore(observationCacheSpec,this.cacheFile,()=>({version:2,observations:snapshot}));
    }).catch(()=>{
      this.cacheWarning="마지막 관찰 기록을 저장하지 못했습니다. 기존 파일을 보존합니다.";
      for(const slot of this.slots.values())slot.state.error=this.cacheWarning;
      this.changes.emit("change");
    });
    return this.cacheWrites;
  }
  async close():Promise<void>{
    clearTimeout(this.cacheTimer);this.cacheTimer=undefined;
    this.closed=true;await Promise.allSettled([...this.slots.values()].map(slot=>this.invalidate(slot)));
    await Promise.allSettled([...this.pending]);
    await this.persistCache();
  }
}
