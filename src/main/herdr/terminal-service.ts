import {CheckoutAdmission} from "./checkout-admission";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import {setTimeout as delay} from "node:timers/promises";
import type { HostTerminalService } from "../host/gateway";
import type { PaneSurfaceFrame, PaneSurfacePatch } from "../../shared/herdr-surface-types";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../storage/json-store";
import { startHerdrRuntime, type HerdrRuntimeOptions } from "./runtime";
import { HerdrCommandError, HerdrDeliveryUnknownError } from "./api-client";
import { applySurfaceEvent } from "../../shared/herdr-surface-model";
import { parseMetadataTokens } from "../../shared/herdr-metadata";
import { configureProviderMods } from "../v2/provider-mods";
import {captureProcessTree,observeProcessTree,parseProcessInventory,readProcessInventory,readBootIdentity,type ProcessIdentity} from "./process-observation";

type JsonObject = Record<string, unknown>;
type Launch = {sessionId:string; kind:string; cwd:string; executable:string; args:string[]; env:Record<string,string>; projectId:string|null; createdAt:string; generation?:string};
interface Geometry {cols:number;rows:number;cellWidthPx:number;cellHeightPx:number}
export interface ManagedSession {id:string; kind:string; cwd:string; projectId:string|null; createdAt:string; generation:string; tabId:string|null; paneId:string|null; delivery:"pending"|"delivered"|"unknown"|"rejected"; status:string; observedAt:number|null; connected:boolean;geometry?:Geometry|null;tokens?:Record<string,string>;processes?:ProcessIdentity[]}
interface Registry {version:2; sessions:ManagedSession[]}
const object = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
class RegistryContentError extends Error {}
const validText=(value:unknown,max=512):value is string=>typeof value==="string"&&value.length>0&&value.length<=max&&!value.includes("\0");
const validGeometry=(value:unknown):value is Geometry=>object(value)&&Number.isInteger(value.cols)&&Number.isInteger(value.rows)&&Number(value.cols)>=1&&Number(value.cols)<=4096&&Number(value.rows)>=1&&Number(value.rows)<=4096&&Number(value.cols)*Number(value.rows)<=1_000_000&&Number.isInteger(value.cellWidthPx)&&Number(value.cellWidthPx)>=0&&Number(value.cellWidthPx)<=1024&&Number.isInteger(value.cellHeightPx)&&Number(value.cellHeightPx)>=0&&Number(value.cellHeightPx)<=1024;
export function parseHerdrSessionRegistry(value:unknown,platform:NodeJS.Platform=process.platform):Registry {
  if(!object(value)||value.version!==2||!Array.isArray(value.sessions)||value.sessions.length>10000) throw new RegistryContentError("Invalid Herdr session registry");
  const ids=new Set<string>();
  const paths=platform==="win32"?path.win32:path.posix;
  for(const s of value.sessions) {
    if(!object(s)||!validText(s.id,128)||!/^[\w-]+$/.test(s.id)||ids.has(s.id)||!validText(s.generation,128)||!validText(s.cwd,32768)||!paths.isAbsolute(s.cwd)||!validText(s.kind,128)||!validText(s.createdAt,128)||!Number.isFinite(Date.parse(s.createdAt))||(s.projectId!==null&&!validText(s.projectId))||(s.tabId!==null&&!validText(s.tabId))||(s.paneId!==null&&!validText(s.paneId))||!['pending','delivered','unknown','rejected'].includes(String(s.delivery))||!validText(s.status,128)||typeof s.connected!=="boolean"||(s.observedAt!==null&&(!Number.isSafeInteger(s.observedAt)||Number(s.observedAt)<0))||(s.geometry!==undefined&&s.geometry!==null&&!validGeometry(s.geometry))||(s.delivery==='delivered'&&(!s.tabId||!s.paneId))) throw new RegistryContentError("Invalid Herdr session record");
    if(s.tokens!==undefined)try {parseMetadataTokens(s.tokens);}catch {throw new RegistryContentError("Invalid Herdr session metadata tokens");}
    if(s.processes!==undefined)try {const records=parseProcessInventory(s.processes);if(!records.length||records.length>10000||records[0].startId===null)throw new Error();}catch {throw new RegistryContentError("Invalid Herdr process identities");}
    ids.add(s.id);
  }
  return value as unknown as Registry;
}
const sessionSpec: JsonStoreSpec<Registry> = {
  label:"Herdr sessions",displayName:"Herdr 세션",empty:()=>({version:2,sessions:[]}),
  parse:parseHerdrSessionRegistry,
  error:(message,options)=>new Error(message,options),isContentError:error=>error instanceof RegistryContentError,
};
export function parseLaunchSpec(value: JsonObject): Launch {
  if(typeof value.sessionId!=="string"||!/^[\w-]{1,128}$/.test(value.sessionId)) throw new Error("Invalid session id");
  if(typeof value.cwd!=="string"||!path.isAbsolute(value.cwd)||value.cwd.includes("\0")) throw new Error("Workspace must be absolute");
  if(typeof value.executable!=="string"||!value.executable||value.executable.includes("\0")) throw new Error("Invalid executable");
  if(!Array.isArray(value.args)||value.args.length>256||value.args.some(arg=>typeof arg!=="string"||arg.includes("\0"))) throw new Error("Invalid launch arguments");
  if(!object(value.env)||Object.entries(value.env).some(([key,v])=>!key||key.length>32767||/[=\x00-\x1f]/.test(key)||typeof v!=="string"||v.includes("\0"))) throw new Error("Invalid environment");
  if(Object.keys(value.env).some(key=>/^HERDR_|^MCW_HERDR_|^MULTI_CLI_WORK_CONTROL_|^JK_/i.test(key))) throw new Error("Launch environment contains reserved control variables");
  if(typeof value.kind!=="string"||typeof value.createdAt!=="string"||!Number.isFinite(Date.parse(value.createdAt))) throw new Error("Invalid session metadata");
  if(value.projectId!==null&&typeof value.projectId!=="string") throw new Error("Invalid project id");
  if(value.generation!==undefined&&typeof value.generation!=="string") throw new Error("Invalid generation");
  if(Buffer.byteLength(JSON.stringify(value))>256*1024) throw new Error("Launch specification too large");
  return value as Launch;
}

interface Bridge {child:ChildProcessWithoutNullStreams; surface:PaneSurfaceFrame|null; owner:string|null; bootId:string|null; focused:boolean; disposed:boolean;ready:boolean;fail:(error:Error)=>void;startupTimer?:ReturnType<typeof setTimeout>;listeners:Set<(frame:unknown)=>void>; pending:Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;chunks:Buffer[];bytes:number;timer:ReturnType<typeof setTimeout>}>}
export async function createHerdrTerminalService(options: HerdrRuntimeOptions & {bridgePath:string;modsDirectory?:string}) {
  if(options.modsDirectory) {
    if(!path.isAbsolute(options.modsDirectory))throw new Error("Managed mods directory must be absolute");
    await fs.access(path.join(options.modsDirectory,"mcw-chips-v2/hooks/register.ts"));
  }
  const file = path.join(options.root,"terminal-sessions.json");
  const initial = await readJsonStore(sessionSpec,file);
  if(!initial.writable) throw new Error(initial.warning ?? "Herdr registry is read only");
  const sessions = new Map<string,ManagedSession>(initial.value.sessions.map(s=>[s.id,{...s,connected:false,delivery:s.delivery==='pending'?'unknown':s.delivery}]));
  if(initial.value.sessions.some(s=>s.delivery==='pending')) await updateJsonStore(sessionSpec,file,()=>({version:2 as const,sessions:[...sessions.values()]}));
  const runtime = await startHerdrRuntime({...options,root:path.join(options.root,"herdr")});
  const bridges = new Map<string,Bridge>();
  const owners = new Map<string,string|null>();
  const observers = new Set<() => void>();
  const viewers = new Map<string, Set<(frame: unknown) => void>>();
  const changed = () => { for (const observer of observers) { try { observer(); } catch { observers.delete(observer); } } };
  const bridgeReconnects = new Map<string,ReturnType<typeof setTimeout>>();
  let closeEvents: (()=>void)|undefined;
  let closed = false, refreshDirty = false;
  let refreshPromise:Promise<void>|undefined;
  let observationPromise:Promise<void>|undefined;
  let observationDirty=false;
  let latestSnapshot:JsonObject={};
  let reconnectTimer: ReturnType<typeof setTimeout>|undefined;
  const admission = new CheckoutAdmission(options.root,()=>readProcessInventory(options.bridgePath),()=>readBootIdentity(options.bridgePath));
  const persist = async () => { await updateJsonStore(sessionSpec,file,()=>({version:2 as const,sessions:[...sessions.values()]})); };
  const session = (id:string) => { const s=sessions.get(id); if(!s) throw new Error("Unknown MCW session"); return s; };
  const emit = (bridge:Bridge,event:unknown) => { for(const listener of bridge.listeners) {try {listener(event);} catch {bridge.listeners.delete(listener);}} };
  const stale = (error:Error) => {
    if(closed) return;
    for(const s of sessions.values()) s.connected=false;
    changed();
    for(const [id,bridge] of bridges) emit(bridge,{type:"disconnected",observedAt:sessions.get(id)?.observedAt??null,reason:error.message});
    closeEvents?.(); closeEvents=undefined;
    clearTimeout(reconnectTimer);
    reconnectTimer=setTimeout(()=>void observe().catch(stale),1000); reconnectTimer.unref();
  };
  const refresh = ():Promise<void> => {
    refreshDirty=true;
    if(refreshPromise) return refreshPromise;
    refreshPromise=(async()=>{
      do {
        refreshDirty=false;
        const {snapshot} = await runtime.api.request<{snapshot:JsonObject&{panes:JsonObject[]}}>("session.snapshot",{});
        latestSnapshot=snapshot;
        // One native read per observation, shared across all managed panes. No
        // command-line arguments, WMI calls or termination signals are involved.
        const inventory=sessions.size?await readProcessInventory(options.bridgePath):[];
        if(sessions.size)await runtime.observeProcesses(inventory);
        let identitiesChanged=false;
        for(const s of sessions.values()) {
          const pane=snapshot.panes.find(p=>p.pane_id===s.paneId);
          const previousProcesses=JSON.stringify(s.processes);
          if(pane&&!s.processes?.length)try {
            const result=await runtime.api.request<{process_info:{shell_pid?:number}}>("pane.process_info",{pane_id:s.paneId});
            if(Number.isSafeInteger(result.process_info?.shell_pid))s.processes=captureProcessTree(result.process_info.shell_pid!,inventory);
          }catch(error){if(!(error instanceof HerdrCommandError&&error.code==="pane_not_found")&&!(error instanceof Error&&/Cannot observe|identity is unavailable/.test(error.message)))throw error;}
          const processes=observeProcessTree(s.processes,inventory);s.processes=processes.processes;
          if(previousProcesses!==JSON.stringify(s.processes))identitiesChanged=true;
          // A closed tab is not exit evidence: Herdr 0.9.5 can leave a child
          // running on Windows. Kernel process identity survives host restart.
          s.connected=true; s.observedAt=Date.now();
          if(pane) {
            s.status=String(pane.agent_status ?? "unknown");
            try {s.tokens=parseMetadataTokens(pane.tokens??{});}catch {s.tokens={};}
          } else if(s.delivery==="delivered") {s.status=processes.status==="running"?"orphaned":processes.status;s.tokens={};}
        }
        if(identitiesChanged)await persist();
      } while(refreshDirty&&!closed);
      reconcileBridges();
      changed();
    })().finally(()=>{refreshPromise=undefined;});
    return refreshPromise;
  };
  async function observe() {
    observationDirty=true;
    if(observationPromise) return observationPromise;
    observationPromise=(async()=>{do {
      observationDirty=false;
      const base=["pane.created","pane.updated","pane.closed","pane.exited","tab.closed"];
      const replace=async(types:Array<string|JsonObject>)=>{
        const next=await runtime.api.subscribe(types,()=>{void refresh().catch(stale);},stale);
        if(closed){next();return;}closeEvents?.();closeEvents=next;
      };
      // Keep non-targeted lifecycle events active while replacing pane-specific
      // subscriptions. A pane can exit between snapshot and subscription admission.
      await replace(base);if(closed)return;await refresh();
      const panes=Array.isArray(latestSnapshot.panes)?latestSnapshot.panes:[];
      const targets=[...sessions.values()].filter(s=>s.paneId&&s.delivery==='delivered'&&s.status!=="exited"&&panes.some(p=>object(p)&&p.pane_id===s.paneId)).map(s=>({type:'pane.agent_status_changed',pane_id:s.paneId}));
      if(targets.length)try{await replace([...base,...targets]);}catch(error){
        if(!(error instanceof HerdrCommandError)||error.code!=="pane_not_found")throw error;
        observationDirty=true; // Observation only; never repeat a launch command.
      }
      await refresh();
    } while(observationDirty&&!closed);})().finally(()=>{observationPromise=undefined;});
    return observationPromise;
  }

  const write = (bridge:Bridge,value:unknown) => {
    if(bridge.disposed||bridge.child.exitCode!==null||bridge.child.stdin.destroyed||bridge.child.stdin.writableEnded) throw new Error("Terminal bridge disconnected");
    const data=JSON.stringify(value)+"\n";
    if(Buffer.byteLength(data)>2*1024*1024) throw new Error("Terminal input exceeds limit");
    if(bridge.child.stdin.writableLength>2*1024*1024) throw new Error("Terminal input is backpressured; delivery not attempted");
    bridge.child.stdin.write(data);
  };
  const endpointRequest = (bridge:Bridge,method:string,params:JsonObject):Promise<unknown> => {
    const id=randomUUID();
    if(bridge.pending.size>=64) return Promise.reject(new Error("Too many pending terminal requests"));
    if(!bridge.bootId) return Promise.reject(new Error("Terminal handshake is not ready"));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{bridge.pending.delete(id);reject(new HerdrDeliveryUnknownError(id,"Endpoint acknowledgement timed out"));},10_000);
      bridge.pending.set(id,{resolve,reject,chunks:[],bytes:0,timer});
      try {write(bridge,{type:"request",bootId:bridge.bootId,request:{id,method,params}});}
      catch(error) { clearTimeout(timer);bridge.pending.delete(id);reject(error); }
    });
  };
  function tabGeometry(tabId:string|null):Geometry|null {
    const layouts=latestSnapshot.layouts;
    const layout=Array.isArray(layouts)?layouts.find(layout=>object(layout)&&layout.tab_id===tabId):undefined;
    const area=object(layout)&&object(layout.area)?layout.area:undefined;
    const value={cols:area?.width,rows:area?.height,cellWidthPx:8,cellHeightPx:16};
    return validGeometry(value)?value:null;
  }
  function reconcileBridges() {
    if(closed) return;
    for(const s of sessions.values()) if(s.delivery==='delivered'&&s.connected&&s.status!=='exited'&&Array.isArray(latestSnapshot.panes)&&latestSnapshot.panes.some(p=>object(p)&&p.pane_id===s.paneId)&&!bridges.has(s.id)&&!bridgeReconnects.has(s.id)) {
      try {openBridge(s.id);} catch(error) {s.connected=false; scheduleBridgeReconnect(s.id);}
    }
  }
  function scheduleBridgeReconnect(id:string) {
    if(closed||bridgeReconnects.has(id)||session(id).status==='exited') return;
    const timer=setTimeout(()=>{bridgeReconnects.delete(id);void refresh().catch(stale);},1000);timer.unref();bridgeReconnects.set(id,timer);
  }
  function openBridge(id:string):Bridge {
    const existing=bridges.get(id); if(existing) return existing;
    const s=session(id); if(!s.paneId||!s.tabId||s.status==="exited") throw new Error("Session is not attached to a running Herdr pane");
    s.geometry??=tabGeometry(s.tabId)??{cols:80,rows:24,cellWidthPx:8,cellHeightPx:16};
    // A new shell initially selects the server's global tab. Preserve that
    // viewport until the connection-scoped tab.focus has acknowledged our target.
    const initialGeometry=tabGeometry(typeof latestSnapshot.focused_tab_id==='string'?latestSnapshot.focused_tab_id:null)??s.geometry;
    const child=spawn(options.bridgePath,["--socket",runtime.paths.clientPath],{windowsHide:true,stdio:"pipe"});
    const listeners=viewers.get(id)??new Set<(frame:unknown)=>void>();viewers.set(id,listeners);
    const bridge:Bridge={child,surface:null,owner:owners.get(id)??null,bootId:null,focused:false,disposed:false,ready:false,fail:()=>{},listeners,pending:new Map()};
    bridges.set(id,bridge);
    let text=""; const decoder=new StringDecoder("utf8");
    let terminateTimer:ReturnType<typeof setTimeout>|undefined;
    const failed=(error:Error)=>{
      if(bridge.disposed) return;
      bridge.disposed=true;clearTimeout(bridge.startupTimer);
      bridges.delete(id); s.connected=false;
      if(s.status==="exited") s.connected=true;
      changed();
      for(const [requestId,pending] of bridge.pending) {clearTimeout(pending.timer);pending.reject(new HerdrDeliveryUnknownError(requestId,error.message));} bridge.pending.clear();
      emit(bridge,{type:"disconnected",observedAt:s.observedAt ?? undefined,reason:error.message});
      text="";child.stdin.end();
      if(child.exitCode===null) {terminateTimer=setTimeout(()=>{if(child.exitCode===null&&!child.killed) child.kill();},1000);terminateTimer.unref();}
      scheduleBridgeReconnect(id);
    };
    bridge.fail=failed;
    child.on("error",failed);child.stdin.on("error",failed);child.stdout.on("error",failed);
    child.on("exit",()=>{clearTimeout(terminateTimer);failed(new Error("Terminal bridge closed"));});
    child.stderr.on("data",()=>{});
    child.stdout.on("data",(chunk:Buffer)=>{
      if(bridge.disposed) return;
      text+=decoder.write(chunk);
      if(Buffer.byteLength(text)>160*1024*1024) {failed(new Error("Terminal frame exceeds limit"));return;}
      for(;;) {
        const end=text.indexOf("\n");if(end<0) break;
        const line=text.slice(0,end);text=text.slice(end+1);
        try { handleBridge(bridge,s,JSON.parse(line)); } catch(error) { failed(error instanceof Error?error:new Error(String(error)));return; }
        if(bridge.disposed) return;
      }
    });
    bridge.startupTimer=setTimeout(()=>failed(new Error("Terminal bridge startup timed out")),15000);bridge.startupTimer.unref();
    try {write(bridge,{type:"hello",...initialGeometry,surfaceActive:true,sizeOwner:true});} catch(error) {failed(error instanceof Error?error:new Error(String(error)));}
    return bridge;
  }
  function handleBridge(bridge:Bridge,s:ManagedSession,event:JsonObject) {
    if(event.type==="control"&&event.kind==="shell.snapshot.v1"&&object(event.data)) {
      bridge.bootId=String(event.data.boot_id);
      if(!bridge.focused) {
        bridge.focused=true;
        void endpointRequest(bridge,"tab.focus",{tab_id:s.tabId}).then(()=>{
          if(!bridge.disposed) write(bridge,{type:'resize',...s.geometry});
        }).catch(error=>bridge.fail(error instanceof Error?error:new Error(String(error))));
      }
    } else if(event.type==="response") {
      const pending=bridge.pending.get(String(event.requestId)); if(!pending) return;
      if(event.bootId!==bridge.bootId) throw new Error("Endpoint response boot differs");
      if(event.dataBytes!==undefined&&(!Array.isArray(event.dataBytes)||event.dataBytes.some(value=>!Number.isInteger(value)||value<0||value>255))) throw new Error("Invalid endpoint response bytes");
      const bytes=Array.isArray(event.dataBytes)?Buffer.from(event.dataBytes):Buffer.from(String(event.data??""));
      pending.chunks.push(bytes);pending.bytes+=bytes.length;
      if(pending.bytes>8*1024*1024) throw new Error("Endpoint response exceeds limit");
      if(event.finalChunk) {
        const reply=JSON.parse(Buffer.concat(pending.chunks).toString("utf8"));
        if(!object(reply)||reply.id!==String(event.requestId)||(!object(reply.error)&&!('result' in reply))) throw new Error("Malformed endpoint response envelope");
        bridge.pending.delete(String(event.requestId));clearTimeout(pending.timer);
        if(object(reply.error)) pending.reject(new HerdrCommandError(String(reply.error.code),String(reply.error.message))); else pending.resolve(reply.result);
      }
    } else if(event.type==="surface"&&object(event.surface)) {
      const surface=event.surface as unknown as PaneSurfaceFrame;
      const result=applySurfaceEvent(bridge.surface,{type:"surface",surface});
      if(result.status==="resync") throw new Error("Invalid terminal surface");
      if(result.status==="stale") return;
      if(!surface.panes.some(p=>p.pane_id===s.paneId)) return;
      bridge.ready=true;clearTimeout(bridge.startupTimer);
      bridge.surface=surface; s.connected=true; s.observedAt=Date.now(); emit(bridge,event);
    } else if(event.type==="patch"&&object(event.patch)&&bridge.surface) {
      const patch=event.patch as unknown as PaneSurfacePatch;
      const result=applySurfaceEvent(bridge.surface,{type:"patch",patch});
      if(result.status==="resync") {bridge.surface=null;write(bridge,{type:"surfaceInterest",active:false});write(bridge,{type:"surfaceInterest",active:true});return;}
      if(result.status==="stale") return;
      bridge.surface=result.surface;
      s.observedAt=Date.now();emit(bridge,event);
    } else if(event.type==="disconnected"||(event.type==="error"&&event.fatal===true)) bridge.fail(new Error(String(event.reason??event.message)));
    else if(event.type==='error') emit(bridge,event);
  }
  const existingBridge=(id:string)=>{session(id);const bridge=bridges.get(id);if(!bridge||bridge.disposed) throw new Error('Terminal endpoint is reconnecting; viewer actions do not launch it');return bridge;};
  const requireControl=(id:string,viewer:string)=>{const bridge=existingBridge(id);if(bridge.owner!==viewer) throw new Error("Terminal control is required");return bridge;};
  const service = {
    onChange(callback:()=>void) {observers.add(callback);return ()=>observers.delete(callback);},
    async refreshObservation(){try{await refresh();}catch(error){stale(error instanceof Error?error:new Error(String(error)));throw error;}},
    async list() {return [...sessions.values()].map(s=>({...s}));},
    acquireCheckoutRemoval:(cwd:string,id:string,pid:number)=>admission.acquire(cwd,id,pid),
    releaseCheckoutRemoval:(id:string)=>admission.release(id),
    removeCheckout:(id:string,repo:string,cwd:string,force:boolean)=>admission.remove(id,repo,cwd,force),
    checkoutRemovalBusy:()=>admission.busy(),
    async create(input:JsonObject):Promise<ManagedSession> {
      const spec=parseLaunchSpec(input);
      if(spec.sessionId.startsWith("mcwr-"))throw new Error("Reserved remote viewer session ID");
      return admission.launch(spec.cwd,async()=>{
        if(sessions.has(spec.sessionId)) throw new Error("Session id already admitted; inspect its delivery state instead of retrying");
        await fs.access(spec.cwd);
        const s:ManagedSession={id:spec.sessionId,kind:spec.kind,cwd:spec.cwd,projectId:spec.projectId,createdAt:spec.createdAt,generation:spec.generation??randomUUID(),tabId:null,paneId:null,delivery:"pending",status:"starting",observedAt:null,connected:true};
        sessions.set(s.id,s);await persist();
        let layoutAttempted=false,layoutConfirmed=false;
        try {
          const snapshot=await runtime.api.request<{snapshot:{workspaces:JsonObject[]}}>("session.snapshot",{});
          let workspace=snapshot.snapshot.workspaces.find(w=>w.label==="MCW managed sessions");
          if(!workspace) {const created=await runtime.api.request("workspace.create",{cwd:spec.cwd,label:"MCW managed sessions",focus:false});workspace=created.workspace as JsonObject;}
          layoutAttempted=true;
          const launch=configureProviderMods({...spec,generation:s.generation},options.binaryPath,options.modsDirectory);
          const result=await runtime.api.request("layout.apply",{workspace_id:workspace.workspace_id,tab_label:s.id,focus:false,root:{type:"pane",cwd:spec.cwd,command:[spec.executable,...launch.args],env:launch.env}});
          const layout=result.layout as {tab_id:string;root:{pane_id:string}};
          if(!layout?.tab_id||!layout.root?.pane_id) throw new HerdrDeliveryUnknownError(s.id,"Unexpected layout response");
          s.tabId=layout.tab_id;s.paneId=layout.root.pane_id;s.delivery="delivered";s.observedAt=Date.now();layoutConfirmed=true;
          s.geometry=tabGeometry(s.tabId)??{cols:80,rows:24,cellWidthPx:8,cellHeightPx:16};
          await persist(); await observe().catch(stale); return {...s};
        } catch(error) {if(!layoutConfirmed) s.delivery=layoutAttempted&&!(error instanceof HerdrCommandError)?"unknown":"rejected";await persist();throw error;}
      });
    },
    async stop(id:string) {
      const s=session(id);if(!s.tabId) throw new Error("Cannot stop an unconfirmed terminal");
      await service.refreshObservation();
      if(s.status==="exited")return;
      if(!s.processes?.length)throw new Error("Cannot verify the pane process identity; stop was not dispatched");
      await runtime.api.request("tab.close",{tab_id:s.tabId});
      const until=Date.now()+2000;
      do {await service.refreshObservation();if(s.status==="exited"||Date.now()>=until)break;await delay(50);}while(!closed);
      await persist();changed();bridges.get(id)?.child.stdin.end();
      if(s.status!=="exited")throw new Error("Herdr closed the pane but process exit is unconfirmed; recovery remains blocked");
    },
    async snapshot(id:string):Promise<{type:"surface";surface:PaneSurfaceFrame}> {
      const bridge=existingBridge(id); if(bridge.surface) return {type:"surface",surface:bridge.surface};
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{bridge.listeners.delete(listener);reject(new Error("Terminal frame timed out"));},10_000);
        const listener=(event:unknown)=>{if(object(event)&&event.type==="surface") {clearTimeout(timer);bridge.listeners.delete(listener);resolve(event as {type:"surface";surface:PaneSurfaceFrame});} else if(object(event)&&event.type==="disconnected") {clearTimeout(timer);bridge.listeners.delete(listener);reject(new Error(String(event.reason)));}};
        bridge.listeners.add(listener);
      });
    },
    subscribeFrames(id:string,callback:(frame:unknown)=>void) {session(id);const listeners=viewers.get(id)??new Set();viewers.set(id,listeners);listeners.add(callback);return ()=>listeners.delete(callback);},
    async input(id:string,viewer:string,event:unknown) {if(!object(event)||Object.keys(event).length!==1||!["Key","TextCommit","Paste","Mouse"].includes(Object.keys(event)[0])) throw new Error("Invalid semantic terminal input");write(requireControl(id,viewer),{type:"input",paneId:session(id).paneId,events:[event]});},
    async resize(id:string,viewer:string,cols:number,rows:number,cellWidthPx=8,cellHeightPx=16) {if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<2||rows<2||cols>500||rows>300||!Number.isInteger(cellWidthPx)||!Number.isInteger(cellHeightPx)||cellWidthPx<1||cellWidthPx>100||cellHeightPx<1||cellHeightPx>100) throw new Error("Invalid terminal size");const bridge=requireControl(id,viewer);session(id).geometry={cols,rows,cellWidthPx,cellHeightPx};await persist();write(bridge,{type:"resize",cols,rows,cellWidthPx,cellHeightPx});},
    async scroll(id:string,viewer:string,delta:number) {if(!Number.isInteger(delta)||Math.abs(delta)>100000) throw new Error("Invalid scroll delta");const bridge=requireControl(id,viewer);const pane=bridge.surface?.panes.find(p=>p.pane_id===session(id).paneId);if(!pane?.scroll) throw new Error('Terminal scroll geometry is not ready');const offset=Math.max(0,Math.min(pane.scroll.max_offset_from_bottom,pane.scroll.offset_from_bottom+delta));await endpointRequest(bridge,"pane.scroll",{pane_id:session(id).paneId,offset_from_bottom:offset});},
    async clear(id:string,viewer:string) {const bridge=requireControl(id,viewer);await endpointRequest(bridge,"pane.clear",{pane_id:session(id).paneId});},
    async selection(id:string,viewer:string,params:Record<string,unknown>) {
      const bridge=requireControl(id,viewer),pane=bridge.surface?.panes.find(p=>p.pane_id===session(id).paneId);
      if(!pane?.scroll || !Number.isSafeInteger(pane.content_revision) || pane.content_revision%2 || params.content_revision!==pane.content_revision) throw new Error("Terminal content changed; select again");
      const lastRow=pane.scroll.max_offset_from_bottom+pane.scroll.viewport_rows-1;
      if(!Number.isSafeInteger(lastRow)||lastRow<0||lastRow>0xffffffff||pane.inner_rect.width<1||pane.inner_rect.width>65536)throw new Error("Terminal selection geometry is invalid");
      const result=await endpointRequest(bridge,"pane.selection.read",{pane_id:session(id).paneId,anchor:{row:0,col:0},cursor:{row:lastRow,col:pane.inner_rect.width-1},content_revision:pane.content_revision});
      if(!object(result)||typeof result.text!=="string"||Buffer.byteLength(result.text)>1024*1024)throw new Error("Terminal selection exceeds the 1 MiB limit or has an invalid response");
      return result;
    },
    async search(id:string,viewer:string,params:Record<string,unknown>) {
      const bridge=requireControl(id,viewer), pane=bridge.surface?.panes.find(p=>p.pane_id===session(id).paneId);
      const point=(v:unknown):v is {row:number;col:number} => object(v)&&Number.isSafeInteger(v.row)&&Number(v.row)>=0&&Number(v.row)<=0xffffffff&&Number.isInteger(v.col)&&Number(v.col)>=0&&Number(v.col)<=65535;
      const previous=params.previous;
      if(!pane || !Number.isSafeInteger(pane.content_revision) || pane.content_revision%2 || params.content_revision!==pane.content_revision) throw new Error("Terminal content changed; refresh and search again");
      if(typeof params.query!=="string" || !params.query || Buffer.byteLength(params.query)>4096 || !["forward","backward"].includes(String(params.direction)) || !point(params.cursor) || (previous!==undefined&&(!object(previous)||!point(previous.start)||!point(previous.end)))) throw new Error("Invalid terminal search");
      return endpointRequest(bridge,"pane.copy_search",{pane_id:session(id).paneId,query:params.query,direction:params.direction,cursor:params.cursor,content_revision:pane.content_revision,...(previous===undefined?{}:{previous})});
    },
    async takeOwnership(id:string,viewer:string) {const bridge=existingBridge(id);if(bridge.owner&&bridge.owner!==viewer) throw new Error("Terminal is owned by another viewer");bridge.owner=viewer;owners.set(id,viewer);emit(bridge,{type:"ownership",ownerId:viewer,sizeOwnerId:viewer});},
    async releaseOwnership(id:string,viewer:string) {if(owners.get(id)===viewer) owners.set(id,null);const bridge=bridges.get(id);if(bridge?.owner===viewer) {bridge.owner=null;emit(bridge,{type:"ownership",ownerId:null,sizeOwnerId:null});}},
    async close(stopServer=false) {closed=true;clearTimeout(reconnectTimer);for(const timer of bridgeReconnects.values()) clearTimeout(timer);bridgeReconnects.clear();closeEvents?.();await refreshPromise?.catch(()=>{});for(const bridge of [...bridges.values()]) bridge.fail(new Error('Host terminal service closed'));if(stopServer) await runtime.stop();await persist();},
  } satisfies HostTerminalService & {close(stopServer?:boolean):Promise<void>};
  await observe();
  return service;
}
