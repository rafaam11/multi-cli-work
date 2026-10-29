import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { HostClient } from "./host-client";
import { isFetchPort } from "./http-port";
import type { HostDescriptor } from "./gateway";

/** The SSH account must already trust the PC's key. Connecting never installs or starts a host. */
export interface SshHostConfiguration {
  hostId: string;
  destination: string;
  username?: string;
  port?: number;
  identityFile?: string;
  knownHostsFile?: string;
  platform: "linux" | "win32";
  nodeExecutable: string;
  hostEntrypoint: string;
  dataRoot: string;
}
interface SshDependencies {
  read?(executable: string, args: string[]): Promise<string>;
  spawn?: typeof spawn;
  sshExecutable?: string;
  onDisconnect?(): void;
}
function validate(configuration: SshHostConfiguration): void {
  if (!/^[\w-]{1,128}$/.test(configuration.hostId) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$/.test(configuration.destination)) throw new Error("Invalid SSH host identity or destination");
  if (configuration.username !== undefined && !/^[a-zA-Z0-9_][a-zA-Z0-9._@\\-]{0,127}$/.test(configuration.username)) throw new Error("Invalid SSH username");
  if (configuration.port !== undefined && (!Number.isInteger(configuration.port) || configuration.port < 1 || configuration.port > 65535)) throw new Error("Invalid SSH port");
  if (!["linux", "win32"].includes(configuration.platform)) throw new Error("Invalid remote platform");
  const remotePath = configuration.platform === "win32" ? path.win32 : path.posix;
  for (const filename of [configuration.nodeExecutable, configuration.hostEntrypoint, configuration.dataRoot]) {
    if (typeof filename !== "string" || !remotePath.isAbsolute(filename) || /[\x00-\x1f]/.test(filename) || filename.length > 32767) throw new Error("Absolute remote runtime paths required");
  }
  for (const filename of [configuration.identityFile, configuration.knownHostsFile]) {
    if (filename !== undefined && (!path.isAbsolute(filename) || /[\x00-\x1f"%]/.test(filename))) throw new Error("Invalid local SSH credential path");
  }
}
/** Fixed flags cannot be overridden by per-host SSH config; ProxyJump/auth preferences still work.
 * https://man.openbsd.org/ssh.1 and ssh_config(5).
 */
export function buildSshArguments(configuration: SshHostConfiguration): string[] {
  validate(configuration);
  const args = ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ExitOnForwardFailure=yes",
    "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "PermitLocalCommand=no", "-o", "ControlMaster=no", "-o", "ControlPath=none",
    "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=2"];
  if (configuration.username) args.push("-l", configuration.username);
  if (configuration.port) args.push("-p", String(configuration.port));
  if (configuration.identityFile) args.push("-i", configuration.identityFile, "-o", "IdentitiesOnly=yes");
  if (configuration.knownHostsFile) args.push("-o", `UserKnownHostsFile="${configuration.knownHostsFile.replace(/\\/g, "/")}"`);
  return args;
}
export function remoteDescriptorCommand(configuration: SshHostConfiguration): string {
  validate(configuration);
  const command = [configuration.nodeExecutable, configuration.hostEntrypoint, "--connection-info", "--data-root", configuration.dataRoot, "--host-id", configuration.hostId];
  if (configuration.platform === "linux") return command.map(value => `'${value.replace(/'/g, `'"'"'`)}'`).join(" ");
  const script = `$ErrorActionPreference='Stop'; & ${command.map(value => `'${value.replace(/'/g, "''")}'`).join(" ")}; exit $LASTEXITCODE`;
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`;
}
async function localPort(): Promise<number> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const server = createServer();
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (address && typeof address !== "string" && isFetchPort(address.port)) return address.port;
  }
  throw new Error("No usable local SSH port available");
}
async function stopTunnel(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const closed = new Promise<void>(resolve => child.once("exit", () => resolve()));
  child.kill();
  await Promise.race([closed, delay(2000,undefined,{ref:false})]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}
/** Only read-only endpoint discovery and a loopback SSH tunnel. No work command is retried. */
export async function connectSshHost(configuration: SshHostConfiguration, dependencies: SshDependencies = {}) {
  const args = buildSshArguments(configuration), executable = dependencies.sshExecutable ?? "ssh";
  const read = dependencies.read ?? (async (binary, command) => (await promisify(execFile)(binary, command, { windowsHide: true, timeout: 15000, maxBuffer: 16384 })).stdout);
  let descriptor: HostDescriptor;
  try { descriptor = JSON.parse(await read(executable, [...args, "-o", "ClearAllForwardings=yes", "--", configuration.destination, remoteDescriptorCommand(configuration)])); }
  catch { throw new Error("SSH host discovery failed. Check the saved host key, account and running MCW host."); }
  if (!descriptor || descriptor.schemaVersion !== 2 || descriptor.hostId !== configuration.hostId || !descriptor.instanceId) throw new Error("Remote MCW host identity differs");
  const remote = new URL(new HostClient(descriptor).connection.url);
  if (!["127.0.0.1", "[::1]"].includes(remote.hostname)) throw new Error("SSH discovery requires a loopback MCW host endpoint");
  const remotePort = Number(remote.port || 80);
  if (!isFetchPort(remotePort)) throw new Error("Remote host port is blocked by Fetch");
  const port = await localPort();
  const child = (dependencies.spawn ?? spawn)(executable, [...args, "-N", "-L", `127.0.0.1:${port}:${remote.hostname}:${remotePort}`, "--", configuration.destination], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let closed = false, disconnected = false;
  const disconnect = () => { if (!disconnected) { disconnected = true; if (!closed) dependencies.onDisconnect?.(); } };
  child.once("error", disconnect); child.once("exit", disconnect);
  child.stderr?.on("data", () => {}); // SSH errors never include the private descriptor in logs.
  const client = new HostClient({ ...descriptor, url: `http://127.0.0.1:${port}`, authority: remote.host });
  try {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline && !disconnected) {
      const health = await client.health().catch(() => null);
      if (health && health.schemaVersion === 2 && health.hostId === configuration.hostId) {
        return { client, close: async () => { if (closed) return; closed = true; await stopTunnel(child); } };
      }
      await delay(100);
    }
    throw new Error("SSH tunnel could not authenticate the expected MCW host");
  } catch (error) { closed = true; await stopTunnel(child); throw error; }
}
