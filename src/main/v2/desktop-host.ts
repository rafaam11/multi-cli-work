import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { ensureHostProcess, readHostDescriptor } from "../host/host-process";
import { HostClient } from "../host/host-client";
import { stageRecoveryAssets, verifyRecoveryAssets, verifyStandaloneNodeRuntime } from "../recovery";
import {resolveHerdrResource,verifyHerdrConptyBundle} from "./herdr-resource";
import {replaceHostWithStoppedHerdr} from "./stopped-herdr-host";

export async function preserveRecoveryRuntime(resourcesDirectory: string, recoveryRoot: string, installDirectory: string, scriptDirectory: string, bridgeDirectory:string): Promise<string> {
  const additionalAssets=await Promise.all([
    {source:path.join(resourcesDirectory,'host/recovery-controller.cjs'),filename:'recovery-controller.cjs',executable:false},
    {source:path.join(bridgeDirectory,process.platform==='win32'?'mcw-herdr-bridge.exe':'mcw-herdr-bridge'),filename:process.platform==='win32'?'recovery-process-bridge.exe':'recovery-process-bridge',executable:true},
  ].map(async asset=>({...asset,sha256:createHash('sha256').update(await fs.readFile(asset.source)).digest('hex')})));
  const startupRescue=path.join(resourcesDirectory,'host/startup-rescue.cjs');
  try{const bytes=await fs.readFile(startupRescue);additionalAssets.push({source:startupRescue,filename:'startup-rescue.cjs',executable:false,sha256:createHash('sha256').update(bytes).digest('hex')});}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const bridgeReceipt=JSON.parse(await fs.readFile(path.join(bridgeDirectory,'bridge.json'),'utf8'));
  if(bridgeReceipt.herdrVersion!=='0.9.5'||bridgeReceipt.sha256!==additionalAssets[1].sha256)throw new Error('독립 복구용 프로세스 브리지 검증에 실패했습니다.');
  const revision=createHash('sha256').update(JSON.stringify(additionalAssets.map(({filename,sha256})=>({filename,sha256})))).update(await fs.readFile(path.join(scriptDirectory,'core.mjs'))).update(await fs.readFile(path.join(scriptDirectory,'recover.mjs'))).digest('hex').slice(0,16);
  const destination = path.join(recoveryRoot, `v1.55.1-recovery-${revision}`);
  const remember=async()=>{const temporary=path.join(recoveryRoot,`active-runtime-${randomUUID()}.tmp`);await fs.writeFile(temporary,JSON.stringify({schemaVersion:1,directory:destination}),{mode:0o600,flag:'wx'});await fs.rename(temporary,path.join(recoveryRoot,'active-runtime.json'));return destination;};
  try { await fs.lstat(destination); await verifyRecoveryAssets(destination, process.platform === "win32" ? "win32" : "deb"); if (process.platform === "linux") await verifyRecoveryAssets(destination,"appimage"); return remember(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const manifest = JSON.parse(await fs.readFile(path.join(resourcesDirectory, "assets.json"), "utf8"));
  const node = manifest.nodeRuntimes.find((entry: {platform: string}) => entry.platform === process.platform);
  if (!node) throw new Error("독립 복구 런타임을 찾을 수 없습니다.");
  const runtime = node.members.find((entry: {output: string}) => entry.output === (process.platform === "win32" ? "node.exe" : "node"));
  const installers = Object.fromEntries(manifest.assets.filter((entry: {role: string; platform: string}) => entry.role === "original-v1-installer" && entry.platform === process.platform).map((entry: {id: string; file: string}) => [entry.id === "recovery-windows" ? "win32" : entry.id === "recovery-deb" ? "deb" : "appimage", path.join(resourcesDirectory, entry.file)]));
  await stageRecoveryAssets({destination,installDirectory,installers,runtimeExecutable:path.join(resourcesDirectory,node.directory,runtime.output),runtimeSha256:runtime.sha256,scriptDirectory,additionalAssets});
  return remember();
}

export async function ensureDesktopHostIdentity(userData:string){
  const directory = path.join(userData, "host"); await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const identityPath = path.join(directory, "identity.json");
  let hostId: string;
  try { hostId = JSON.parse(await fs.readFile(identityPath, "utf8")).hostId; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; hostId = randomUUID(); await fs.writeFile(identityPath, JSON.stringify({ hostId }), { mode: 0o600, flag: "wx" }); }
  if (typeof hostId !== "string" || !/^[\w-]{1,128}$/.test(hostId)) throw new Error("호스트 식별 정보를 확인해야 합니다.");
  return {directory,hostId};
}

export interface DesktopHostOptions { userData: string; registryRoot:string; resourcesDirectory: string; bridgeDirectory: string; entryPath: string }
/** Resolve only digest-pinned packaged runtimes. Never use a user's PATH Herdr installation. */
export async function startDesktopHost(options: DesktopHostOptions) {
  const manifest = JSON.parse(await fs.readFile(path.join(options.resourcesDirectory, "assets.json"), "utf8"));
  if (manifest.herdrVersion !== "0.9.5" || !["win32", "linux"].includes(process.platform)) throw new Error("지원되는 Herdr 런타임이 없습니다.");
  const {binaryPath,binarySha256}=await resolveHerdrResource(options.resourcesDirectory);
  if (process.platform === "win32") await verifyHerdrConptyBundle(options.resourcesDirectory);
  const bridgePath = path.join(options.bridgeDirectory, process.platform === "win32" ? "mcw-herdr-bridge.exe" : "mcw-herdr-bridge");
  const bridge = JSON.parse(await fs.readFile(path.join(options.bridgeDirectory, "bridge.json"), "utf8"));
  const digest = createHash("sha256").update(await fs.readFile(bridgePath)).digest("hex");
  if (bridge.sha256 !== digest || bridge.herdrVersion !== "0.9.5") throw new Error("터미널 브리지 검증에 실패했습니다.");
  const {directory,hostId}=await ensureDesktopHostIdentity(options.userData);
  if (await replaceHostWithStoppedHerdr({directory,hostId,bridgePath}) === "replaced") console.warn("Replaced a host whose Herdr server had stopped; no session process was running.");
  const node =manifest.nodeRuntimes.find((entry: {platform: string}) => entry.platform === process.platform);
  const runtime = node?.members.find((entry: {output: string}) => entry.output === (process.platform === "win32" ? "node.exe" : "node"));
  if (!runtime) throw new Error("독립 호스트 런타임을 찾을 수 없습니다.");
  const executablePath = path.join(options.resourcesDirectory,node.directory,runtime.output);
  await verifyStandaloneNodeRuntime(executablePath,runtime.sha256);
  const descriptor = await ensureHostProcess({ directory, hostId, entryPath: options.entryPath, executablePath, electronExecutable: false, catalogPaths:{userData:options.userData,registryRoot:options.registryRoot},mobileConfig:{userData:options.userData,rendererDir:path.join(options.resourcesDirectory,'mobile'),shellDirectory:path.join(options.resourcesDirectory,'mobile-shell'),bindOverride:process.env.MULTI_CLI_WORK_REMOTE_BIND},terminalConfig: { binaryPath, binarySha256, bridgePath, modsDirectory:path.join(options.resourcesDirectory,"mods") } });
  const client = new HostClient(descriptor);
  return { hostId, client, refresh: async () => {
    const next = await readHostDescriptor(directory);
    if (!next || next.hostId !== hostId) throw new Error("호스트 연결 정보를 확인할 수 없습니다.");
    await client.reconnect(next, hostId);
  } };
}
