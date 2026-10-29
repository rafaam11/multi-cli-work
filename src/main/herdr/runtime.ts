import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { HerdrApiClient } from "./api-client";

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

export interface HerdrRuntimeOptions {root:string; binaryPath:string; binarySha256:string}
export async function startHerdrRuntime(options: HerdrRuntimeOptions) {
  await verifyHerdrBinary(options.binaryPath,options.binarySha256);
  const root = path.resolve(options.root);
  const paths = resolveHerdrPaths(root);
  const api = new HerdrApiClient(paths.endpoint);
  const isReady = async () => {
    const pong = await api.request("ping",{});
    if (pong.version !== "0.9.5") throw new Error(`Expected Herdr 0.9.5, received ${String(pong.version)}`);
  };
  let started = false;
  try { await isReady(); }
  catch (error) {
    if (!["ENOENT","ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    await fs.mkdir(paths.directory,{recursive:true,mode:0o700});
    await fs.mkdir(paths.state,{recursive:true,mode:0o700});
    // This file belongs to the managed runtime, never the user's Herdr config.
    const configPath = path.join(paths.config,"herdr","mcw.toml");
    await fs.writeFile(configPath,"[session]\nresume_agents_on_restore = false\n[update]\nversion_check = false\nmanifest_check = false\n",{mode:0o600});
    const log = await fs.open(path.join(root,"herdr-server.log"),"a",0o600);
    let spawnError: Error | undefined;
    const child = spawn(options.binaryPath,["--session","mcw-v2","server"],{
      cwd:root,detached:true,windowsHide:true,stdio:["ignore",log.fd,log.fd],
      env:{...process.env,XDG_CONFIG_HOME:paths.config,XDG_STATE_HOME:paths.state,HERDR_CONFIG_PATH:configPath,HERDR_SOCKET_PATH:undefined,HERDR_CLIENT_SOCKET_PATH:undefined,HERDR_SESSION:undefined},
    });
    child.once("error", error => { spawnError = error; });
    child.unref();
    await log.close();
    const deadline = Date.now()+15_000;
    for (;;) {
      if (spawnError) throw spawnError;
      try { await isReady(); break; }
      catch (error) {
        if (Date.now() >= deadline || child.exitCode !== null) throw new Error(`Herdr startup failed: ${error instanceof Error ? error.message : String(error)}`);
        await delay(100);
      }
    }
    started = true;
  }
  return {api,paths,started,async stop() {
    // Only explicit owner shutdown uses this; detaching a GUI does not call it.
    await api.request("server.stop",{});
    const deadline = Date.now()+10_000;
    for (;;) {
      try { await api.request("ping",{}); }
      catch (error) {
        if (["ENOENT","ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
        if (Date.now() >= deadline) throw error;
      }
      if (Date.now() >= deadline) throw new Error("Herdr has not stopped; no forced termination attempted");
      await delay(100);
    }
  }};
}
