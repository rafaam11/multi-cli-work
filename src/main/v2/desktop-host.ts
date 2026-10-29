import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { ensureHostProcess, readHostDescriptor } from "../host/host-process";
import { HostClient } from "../host/host-client";
import { stageRecoveryAssets, verifyRecoveryAssets, verifyStandaloneNodeRuntime } from "../recovery";

export async function preserveRecoveryRuntime(resourcesDirectory: string, recoveryRoot: string, installDirectory: string, scriptDirectory: string): Promise<void> {
  const destination = path.join(recoveryRoot, "v1.55.1-recovery");
  try { await fs.lstat(destination); await verifyRecoveryAssets(destination, process.platform === "win32" ? "win32" : "deb"); if (process.platform === "linux") await verifyRecoveryAssets(destination,"appimage"); return; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const manifest = JSON.parse(await fs.readFile(path.join(resourcesDirectory, "assets.json"), "utf8"));
  const node = manifest.nodeRuntimes.find((entry: {platform: string}) => entry.platform === process.platform);
  if (!node) throw new Error("독립 복구 런타임을 찾을 수 없습니다.");
  const runtime = node.members.find((entry: {output: string}) => entry.output === (process.platform === "win32" ? "node.exe" : "node"));
  const installers = Object.fromEntries(manifest.assets.filter((entry: {role: string; platform: string}) => entry.role === "original-v1-installer" && entry.platform === process.platform).map((entry: {id: string; file: string}) => [entry.id === "recovery-windows" ? "win32" : entry.id === "recovery-deb" ? "deb" : "appimage", path.join(resourcesDirectory, entry.file)]));
  await stageRecoveryAssets({destination,installDirectory,installers,runtimeExecutable:path.join(resourcesDirectory,node.directory,runtime.output),runtimeSha256:runtime.sha256,scriptDirectory});
}

export interface DesktopHostOptions { userData: string; resourcesDirectory: string; bridgeDirectory: string; entryPath: string }
/** Resolve only digest-pinned packaged runtimes. Never use a user's PATH Herdr installation. */
export async function startDesktopHost(options: DesktopHostOptions) {
  const manifest = JSON.parse(await fs.readFile(path.join(options.resourcesDirectory, "assets.json"), "utf8"));
  if (manifest.herdrVersion !== "0.9.5" || !["win32", "linux"].includes(process.platform)) throw new Error("지원되는 Herdr 런타임이 없습니다.");
  const binaryPath = path.join(options.resourcesDirectory, process.platform === "win32" ? "herdr/windows/herdr.exe" : "herdr/herdr-linux-x86_64");
  const binarySha256 = process.platform === "win32" ? manifest.windowsMembers.find((entry: { file: string }) => entry.file === "herdr.exe")?.sha256 : manifest.assets.find((entry: { id: string }) => entry.id === "herdr-linux")?.sha256;
  const bridgePath = path.join(options.bridgeDirectory, process.platform === "win32" ? "mcw-herdr-bridge.exe" : "mcw-herdr-bridge");
  const bridge = JSON.parse(await fs.readFile(path.join(options.bridgeDirectory, "bridge.json"), "utf8"));
  const digest = createHash("sha256").update(await fs.readFile(bridgePath)).digest("hex");
  if (bridge.sha256 !== digest || bridge.herdrVersion !== "0.9.5") throw new Error("터미널 브리지 검증에 실패했습니다.");
  const directory = path.join(options.userData, "host"); await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const identityPath = path.join(directory, "identity.json");
  let hostId: string;
  try { hostId = JSON.parse(await fs.readFile(identityPath, "utf8")).hostId; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; hostId = randomUUID(); await fs.writeFile(identityPath, JSON.stringify({ hostId }), { mode: 0o600, flag: "wx" }); }
  if (typeof hostId !== "string" || !/^[\w-]{1,128}$/.test(hostId)) throw new Error("호스트 식별 정보를 확인해야 합니다.");
  const node = manifest.nodeRuntimes.find((entry: {platform: string}) => entry.platform === process.platform);
  const runtime = node?.members.find((entry: {output: string}) => entry.output === (process.platform === "win32" ? "node.exe" : "node"));
  if (!runtime) throw new Error("독립 호스트 런타임을 찾을 수 없습니다.");
  const executablePath = path.join(options.resourcesDirectory,node.directory,runtime.output);
  await verifyStandaloneNodeRuntime(executablePath,runtime.sha256);
  const descriptor = await ensureHostProcess({ directory, hostId, entryPath: options.entryPath, executablePath, electronExecutable: false, terminalConfig: { binaryPath, binarySha256, bridgePath, modsDirectory:path.join(options.resourcesDirectory,"mods") } });
  const client = new HostClient(descriptor);
  return { hostId, client, refresh: async () => {
    const next = await readHostDescriptor(directory);
    if (!next || next.hostId !== hostId) throw new Error("호스트 연결 정보를 확인할 수 없습니다.");
    await client.reconnect(next, hostId);
  } };
}
