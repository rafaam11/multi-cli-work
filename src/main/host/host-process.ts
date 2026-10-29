import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import lockfile from "proper-lockfile";
import { hostDescriptorPath, type HostDescriptor } from "./gateway";
import { HostClient } from "./host-client";
import { isolatedHostEnvironment } from "../v2/provider-mods";

export interface HostProcessOptions {
  directory: string; hostId: string; entryPath: string; executablePath?: string; electronExecutable?: boolean;
  terminalConfig: { binaryPath: string; binarySha256: string; bridgePath: string; modsDirectory?:string };
  catalogPaths?:import("./execution-catalog").HostCatalogPaths;
  bindAddress?: string; allowRemote?: boolean; advertisedHost?: string; startupTimeoutMs?: number;
}
export async function readHostDescriptor(directory: string): Promise<HostDescriptor | null> {
  let value: HostDescriptor;
  try { value = JSON.parse(await fs.readFile(hostDescriptorPath(directory), "utf8")) as HostDescriptor; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("Host descriptor is unreadable", { cause: error }); }
  if (value.schemaVersion !== 2 || !Number.isSafeInteger(value.pid) || value.pid < 1 || typeof value.instanceId !== "string" || !value.instanceId || typeof value.hostId !== "string" || !value.hostId || !Number.isFinite(value.startedAt)) throw new Error("Invalid host descriptor");
  new HostClient(value); return value;
}
function isAlive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } }
async function ready(descriptor: HostDescriptor): Promise<boolean> {
  try {
    const response = await fetch(`${descriptor.url}/health`, { headers: { authorization: `Bearer ${descriptor.token}` }, redirect: "error", signal: AbortSignal.timeout(1000) });
    const health = await response.json() as { hostId: string; instanceId: string };
    return response.ok && health.hostId === descriptor.hostId && health.instanceId === descriptor.instanceId;
  } catch { return false; }
}
/** Serialize launchers. A live but unavailable host is never killed or replaced automatically. */
export async function ensureHostProcess(options: HostProcessOptions): Promise<HostDescriptor> {
  await fs.mkdir(options.directory, { recursive: true, mode: 0o700 });
  const timeout = options.startupTimeoutMs ?? 15000;
  const release = await lockfile.lock(path.join(options.directory, "mcw-host-start"), { realpath: false, stale: 30000, retries: { retries: Math.ceil(timeout / 100), minTimeout: 100, maxTimeout: 100, factor: 1 } });
  try {
    const existing = await readHostDescriptor(options.directory);
    if (existing) {
      if (existing.hostId !== options.hostId) throw new Error("Existing host identity differs");
      if (await ready(existing)) return existing;
      if (isAlive(existing.pid)) throw new Error("Existing host is alive but unavailable; reconcile it before starting another host");
    }
    let child: ReturnType<typeof spawn> | undefined;
    let launchError: Error | undefined;
    const launch = () => {
      const executable = options.executablePath ?? process.execPath;
      const env = isolatedHostEnvironment(process.env);
      const electron = options.electronExecutable ?? (executable === process.execPath && !!process.versions.electron);
      if (electron) env.ELECTRON_RUN_AS_NODE = "1"; else delete env.ELECTRON_RUN_AS_NODE;
      const args = [options.entryPath, "--mcw-host", "--data-root", path.resolve(options.directory), "--host-id", options.hostId, "--terminal-config", JSON.stringify(options.terminalConfig)];
      if(options.catalogPaths)args.push("--catalog-paths",JSON.stringify(options.catalogPaths));
      if (options.bindAddress) args.push("--bind-address", options.bindAddress);
      if (options.allowRemote) args.push("--allow-remote");
      if (options.advertisedHost) args.push("--advertised-host", options.advertisedHost);
      child = spawn(executable, args, { detached: true, windowsHide: true, stdio: "ignore", env, cwd: path.dirname(path.resolve(options.entryPath)) });
      child.once("error", error => { launchError = error; }); child.unref();
    };
    const deadline = Date.now() + timeout;
    do {
      if (launchError) throw new Error("Host process could not start", { cause: launchError });
      if (child && child.exitCode !== null) throw new Error("Host process exited before readiness");
      const descriptor = await readHostDescriptor(options.directory);
      if (descriptor && descriptor.hostId === options.hostId && (!existing || descriptor.instanceId !== existing.instanceId) && await ready(descriptor)) return descriptor;
      if (!child && !await lockfile.check(path.join(options.directory, "mcw-host-runtime"), { realpath: false, stale: 10000 })) launch();
      await delay(100);
    } while (Date.now() < deadline);
    // Leave a slow host alive: killing it could interrupt work already accepted elsewhere.
    throw new Error("Host did not become ready within the startup deadline");
  } finally { await release(); }
}
