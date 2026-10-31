// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer, type Server } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { replaceHostWithStoppedHerdr } from "./stopped-herdr-host";
import type { ProcessObservation } from "../herdr/process-observation";

const hostId = "host-1", instanceId = "instance-1", token = "a".repeat(43);
const proc = (pid: number, startId: string, parentPid = 1): ProcessObservation => ({ pid, parentPid, startId, name: "node.exe", executable: null });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture(options: { sessions?: unknown[] } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-stopped-herdr-"));
  const server: Server = createServer((_request, response) => { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ schemaVersion: 2, hostId, instanceId, accepting: true })); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); });
  const port = (server.address() as { port: number }).port;
  await fs.mkdir(path.join(directory, "herdr"), { recursive: true });
  await fs.writeFile(path.join(directory, "mcw-host.json"), JSON.stringify({ schemaVersion: 2, pid: 4000, instanceId, hostId, url: `http://127.0.0.1:${port}`, token, startedAt: Date.now() }));
  await fs.writeFile(path.join(directory, "host-process-identity.json"), JSON.stringify({ schemaVersion: 1, hostId, process: proc(4000, "windows:host") }));
  await fs.writeFile(path.join(directory, "herdr/runtime-processes.json"), JSON.stringify([proc(5000, "windows:herdr", 4000)]));
  await fs.writeFile(path.join(directory, "terminal-sessions.json"), JSON.stringify({ version: 2, sessions: options.sessions ?? [{ id: "never-started", status: "starting", delivery: "rejected" }] }));
  return directory;
}

it("replaces a v2.0.0 host whose Herdr server panicked before any session process started", async () => {
  const directory = await fixture();
  let alive = [proc(4000, "windows:host")];
  const terminate = vi.fn(() => { alive = []; });
  expect(await replaceHostWithStoppedHerdr({ directory, hostId, bridgePath: "unused", herdrRunning: async () => false, inventory: async () => alive, terminate })).toBe("replaced");
  expect(terminate).toHaveBeenCalledWith(4000);
});

it("keeps the host when Herdr answers, or its state cannot be determined", async () => {
  const directory = await fixture();
  const terminate = vi.fn();
  const inventory = async () => [proc(4000, "windows:host")];
  for (const herdrRunning of [async () => true, async () => null])
    expect(await replaceHostWithStoppedHerdr({ directory, hostId, bridgePath: "unused", herdrRunning, inventory, terminate })).toBe("kept");
  expect(await replaceHostWithStoppedHerdr({ directory, hostId, bridgePath: "unused", herdrRunning: async () => false, inventory: async () => { throw new Error("snapshot unavailable"); }, terminate })).toBe("kept");
  expect(terminate).not.toHaveBeenCalled();
});

it("never kills a host while a recorded Herdr or pane process may still run", async () => {
  const terminate = vi.fn();
  const pane = await fixture({ sessions: [{ id: "live", status: "idle", delivery: "delivered", processes: [proc(6000, "windows:pane", 5000)] }] });
  expect(await replaceHostWithStoppedHerdr({ directory: pane, hostId, bridgePath: "unused", herdrRunning: async () => false, inventory: async () => [proc(4000, "windows:host"), proc(6000, "windows:pane", 5000)], terminate })).toBe("kept");
  const herdr = await fixture();
  expect(await replaceHostWithStoppedHerdr({ directory: herdr, hostId, bridgePath: "unused", herdrRunning: async () => false, inventory: async () => [proc(4000, "windows:host"), proc(5000, "windows:herdr", 4000)], terminate })).toBe("kept");
  expect(terminate).not.toHaveBeenCalled();
});

it("does not signal a reused PID whose creation identity differs from the recorded host", async () => {
  const directory = await fixture();
  const terminate = vi.fn();
  expect(await replaceHostWithStoppedHerdr({ directory, hostId, bridgePath: "unused", herdrRunning: async () => false, inventory: async () => [proc(4000, "windows:other")], terminate })).toBe("kept");
  expect(terminate).not.toHaveBeenCalled();
});
