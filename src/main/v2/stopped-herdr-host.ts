import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { readHostDescriptor } from "../host/host-process";
import { HostClient } from "../host/host-client";
import { HerdrApiClient } from "../herdr/api-client";
import { resolveHerdrPaths } from "../herdr/runtime";
import { observeProcessTree, readProcessInventory, type ProcessIdentity, type ProcessObservation } from "../herdr/process-observation";

export interface StoppedHerdrHostOptions {
  directory: string; hostId: string; bridgePath: string;
  inventory?: () => Promise<ProcessObservation[]>;
  herdrRunning?: () => Promise<boolean | null>;
  terminate?: (pid: number) => void;
}
const readJson = async (file: string): Promise<unknown> => {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
};
/** true: the Herdr endpoint answers. false: nothing listens. null: cannot tell. */
async function pingHerdr(directory: string): Promise<boolean | null> {
  try { await new HerdrApiClient(resolveHerdrPaths(path.join(directory, "herdr")).endpoint, { timeoutMs: 3000 }).request("ping", {}); return true; }
  catch (error) { return ["ENOENT", "ECONNREFUSED"].includes((error as NodeJS.ErrnoException).code ?? "") ? false : null; }
}
/**
 * A v2.0.0 host keeps answering after its Herdr server panics, rejecting every
 * session, and the desktop reconnects to it even after an update. Replace such a
 * host only when nothing it started can still run: its Herdr server is gone, the
 * recorded Herdr and pane processes have exited, and the host's own kernel identity
 * matches. Any other unavailable or uncertain host is still never killed.
 */
export async function replaceHostWithStoppedHerdr(options: StoppedHerdrHostOptions): Promise<"kept" | "replaced"> {
  const inventory = options.inventory ?? (() => readProcessInventory(options.bridgePath));
  // Any doubt (unreadable state, unavailable process snapshot) keeps the host.
  const target = await stoppedHerdrHostProcess(options, inventory).catch(() => null);
  if (!target) return "kept";
  (options.terminate ?? (pid => process.kill(pid)))(target.pid);
  for (const deadline = Date.now() + 10_000; Date.now() < deadline; await delay(100)) {
    if ((await inventory().catch(() => null))?.every(process => process.pid !== target.pid || process.startId !== target.startId)) return "replaced";
  }
  throw new Error("Herdr가 멈춘 이전 호스트를 종료하지 못했습니다. 컴퓨터를 다시 시작한 뒤 앱을 여세요.");
}
async function stoppedHerdrHostProcess(options: StoppedHerdrHostOptions, inventory: () => Promise<ProcessObservation[]>): Promise<ProcessIdentity | null> {
  const descriptor = await readHostDescriptor(options.directory).catch(() => null);
  if (!descriptor || descriptor.hostId !== options.hostId) return null;
  try { await new HostClient(descriptor).health(); } catch { return null; }
  if (await (options.herdrRunning ?? (() => pingHerdr(options.directory)))() !== false) return null;
  const current = await inventory();
  const herdr = await readJson(path.join(options.directory, "herdr/runtime-processes.json"));
  if (!Array.isArray(herdr) || observeProcessTree(herdr as ProcessIdentity[], current).status !== "exited") return null;
  const registry = await readJson(path.join(options.directory, "terminal-sessions.json")) as { sessions?: { processes?: ProcessIdentity[] }[] } | null;
  if (!registry || !Array.isArray(registry.sessions)) return null;
  if (registry.sessions.some(session => session.processes?.length && observeProcessTree(session.processes, current).status !== "exited")) return null;
  const identity = await readJson(path.join(options.directory, "host-process-identity.json")) as { hostId?: string; process?: ProcessIdentity } | null;
  const recorded = identity?.process;
  if (identity?.hostId !== options.hostId || !recorded || recorded.pid !== descriptor.pid || !recorded.startId) return null;
  return current.find(process => process.pid === recorded.pid)?.startId === recorded.startId ? recorded : null;
}
