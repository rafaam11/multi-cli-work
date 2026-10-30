import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { HerdrApiClient } from "./api-client";
import { isolatedHostEnvironment } from "../v2/provider-mods";
import {captureProcessTree,observeProcessTree,parseProcessInventory,readProcessInventory,type ProcessIdentity,type ProcessObservation} from "./process-observation";
import {readJsonStore,updateJsonStore,type JsonStoreSpec} from "../storage/json-store";

class RuntimeIdentityError extends Error {}
const runtimeIdentitySpec:JsonStoreSpec<ProcessIdentity[]>={label:"Herdr runtime processes",displayName:"Herdr 프로세스",empty:()=>[],parse:value=>{
  try {const records=parseProcessInventory(value);if(records.length>100000||(records.length&&records[0].startId===null))throw new Error();return records;}
  catch {throw new RuntimeIdentityError("Invalid Herdr runtime identities");}
},error:(message,options)=>new RuntimeIdentityError(message,options),isContentError:error=>error instanceof RuntimeIdentityError};

export function resolveHerdrPaths(root: string, platform: NodeJS.Platform = process.platform) {
  const p = platform === "win32" ? path.win32 : path.posix;
  const config = p.join(root,"config");
  const state = p.join(root,"state");
  const directory = p.join(config,"herdr","sessions","mcw-v2");
  const apiPath = p.join(directory,"herdr.sock");
  return {config,state,directory,apiPath,clientPath:p.join(directory,"herdr-client.sock"),endpoint:platform === "win32" ? `\\\\.\\pipe\\${apiPath}` : apiPath};
}

export async function verifyHerdrBinary(binaryPath: string, sha256: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error("Invalid pinned Herdr SHA-256");
  const info = await fs.lstat(binaryPath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Herdr must be a regular managed file");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(binaryPath)) hash.update(chunk);
  if (hash.digest("hex") !== sha256) throw new Error("Herdr SHA-256 mismatch; refusing execution");
}

export interface HerdrRuntimeOptions {root:string; binaryPath:string; binarySha256:string;bridgePath:string}
export async function startHerdrRuntime(options: HerdrRuntimeOptions) {
  await verifyHerdrBinary(options.binaryPath,options.binarySha256);
  const root = path.resolve(options.root);
  const paths = resolveHerdrPaths(root);
  const api = new HerdrApiClient(paths.endpoint);
  const identityPath=path.join(root,"runtime-processes.json");
  const stored=await readJsonStore(runtimeIdentitySpec,identityPath);
  if(!stored.writable)throw new Error(stored.warning??"Herdr process identities are read only");
  let processes:ProcessIdentity[]|undefined=stored.value.length?stored.value:undefined;
  const saveProcesses=async(next:ProcessIdentity[])=>{await updateJsonStore(runtimeIdentitySpec,identityPath,()=>next);processes=next;};
  const isReady = async () => {
    const pong = await api.request("ping",{});
    const expected=process.platform==="win32"?"0.9.5-mcw.1":"0.9.5";
    if (pong.version !== expected) throw new Error(`Expected Herdr ${expected}, received ${String(pong.version)}`);
  };
  let started = false;
  try { await isReady(); }
  catch (error) {
    if (!["ENOENT","ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    if(processes&&observeProcessTree(processes,await readProcessInventory(options.bridgePath)).status!=="exited")throw new Error("Previous Herdr runtime still has unobserved or running processes; refusing a new server");
    await fs.mkdir(paths.directory,{recursive:true,mode:0o700});
    await fs.mkdir(paths.state,{recursive:true,mode:0o700});
    // This file belongs to the managed runtime, never the user's Herdr config.
    const configPath = path.join(paths.config,"herdr","mcw.toml");
    await fs.writeFile(configPath,"[session]\nresume_agents_on_restore = false\n[update]\nversion_check = false\nmanifest_check = false\n",{mode:0o600});
    const log = await fs.open(path.join(root,"herdr-server.log"),"a",0o600);
    let spawnError: Error | undefined;
    const child = spawn(options.binaryPath,["--session","mcw-v2","server"],{
      cwd:root,detached:true,windowsHide:true,stdio:["ignore",log.fd,log.fd],
      env:{...isolatedHostEnvironment(process.env),XDG_CONFIG_HOME:paths.config,XDG_STATE_HOME:paths.state,HERDR_CONFIG_PATH:configPath},
    });
    child.once("error", error => { spawnError = error; });
    child.unref();
    await log.close();
    if(!child.pid)throw spawnError??new Error("Herdr process identity unavailable");
    // Record the owned child even if version negotiation later fails. A failed
    // startup must not leave an unidentified process or permit duplicate launch.
    await saveProcesses(captureProcessTree(child.pid,await readProcessInventory(options.bridgePath)));
    const deadline = Date.now()+15_000;
    for (;;) {
      if (spawnError) throw spawnError;
      try { await isReady(); break; }
      catch (error) {
        if (Date.now() >= deadline || child.exitCode !== null) throw new Error(`Herdr startup failed: ${error instanceof Error ? error.message : String(error)}`);
        await delay(100);
      }
    }
    await saveProcesses(captureProcessTree(child.pid,await readProcessInventory(options.bridgePath)));
    started = true;
  }
  const observeProcesses=async(inventory:ProcessObservation[])=>{
    const observed=observeProcessTree(processes,inventory);
    if(observed.processes&&JSON.stringify(observed.processes)!==JSON.stringify(processes))await saveProcesses(observed.processes);
    return observed;
  };
  return {api,paths,started,observeProcesses,async stop() {
    // Only explicit owner shutdown uses this; detaching a GUI does not call it.
    if(!processes?.length)throw new Error("Cannot verify Herdr runtime identity; no shutdown dispatched");
    await observeProcesses(await readProcessInventory(options.bridgePath));
    await api.request("server.stop",{});
    const deadline = Date.now()+10_000;
    for (;;) {
      try { await api.request("ping",{}); }
      catch (error) {
        if (["ENOENT","ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "")) {
          const observed=await observeProcesses(await readProcessInventory(options.bridgePath));
          if(observed.status==="exited")return;
          if(Date.now()>=deadline)throw new Error("Herdr endpoint closed but runtime processes remain; recovery blocked");
        }
        if (Date.now() >= deadline) throw error;
      }
      if (Date.now() >= deadline) throw new Error("Herdr has not stopped; no forced termination attempted");
      await delay(100);
    }
  }};
}
