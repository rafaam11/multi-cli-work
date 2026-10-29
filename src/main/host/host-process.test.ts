// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ensureHostProcess, readHostDescriptor } from "./host-process";
import { HostClient } from "./host-client";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true, maxRetries: 20, retryDelay: 100 }))); });
const terminalConfig = { binaryPath: "fixture-only", binarySha256: "0".repeat(64), bridgePath: "fixture-only" };
it("starts one detached Node host, removes Electron-only environment and rediscovers it independently", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcw-host-launch-test-")); directories.push(directory);
  const entryPath = path.join(directory, "fixture.cjs");
  // A disposable standalone host proves process-launch/readiness behavior without loading Herdr
  // or touching user state. It self-exits on a short deadline even if an assertion fails.
  await writeFile(entryPath, `
const http = require('node:http'); const fs = require('node:fs'); const path = require('node:path'); const crypto = require('node:crypto');
const option = name => process.argv[process.argv.indexOf(name)+1];
const root=option('--data-root'); const token=crypto.randomBytes(32).toString('base64url'); const instanceId=crypto.randomUUID();
const deadline=setTimeout(()=>process.exit(0),15000);
const server=http.createServer((req,res)=>{
  if(req.headers.authorization!=='Bearer '+token) {res.writeHead(401);res.end('{}');return;}
  res.setHeader('content-type','application/json');
  if(req.url==='/shutdown') {res.end(JSON.stringify({shutdown:true}));server.close(()=>{clearTimeout(deadline);process.exit(0);});server.closeIdleConnections();return;}
  if(req.url==='/health') {res.end(JSON.stringify({schemaVersion:2,hostId:option('--host-id'),instanceId,accepting:true}));return;}
  res.end('{}');
}, 20000);
server.listen(0,'127.0.0.1',()=>{
  const descriptor={schemaVersion:2,pid:process.pid,hostId:option('--host-id'),instanceId,url:'http://127.0.0.1:'+server.address().port,token,startedAt:Date.now()};
  fs.writeFileSync(path.join(root,'fixture-env.json'),JSON.stringify({electron:process.env.ELECTRON_RUN_AS_NODE ?? null}),{mode:0o600});
  fs.writeFileSync(path.join(root,'mcw-host.json'),JSON.stringify(descriptor),{mode:0o600});
});
`, "utf8");
  const before = process.env.ELECTRON_RUN_AS_NODE;
  try {
    process.env.ELECTRON_RUN_AS_NODE = "1";
    const options = { directory, hostId: "fixture-host", entryPath, terminalConfig, executablePath: process.execPath, electronExecutable: false, startupTimeoutMs: 5000 };
    const [first, second] = await Promise.all([ensureHostProcess(options), ensureHostProcess(options)]);
    try {
      expect(first.pid).not.toBe(process.pid); expect(second.pid).toBe(first.pid); expect(second.instanceId).toBe(first.instanceId);
      expect(JSON.parse(await readFile(path.join(directory, "fixture-env.json"), "utf8")).electron).toBe(null);
      expect((await new HostClient(await readHostDescriptor(directory)! as NonNullable<Awaited<ReturnType<typeof readHostDescriptor>>>).health()).instanceId).toBe(first.instanceId);
    } finally { await new HostClient(first).shutdown(); }
  } finally { if (before === undefined) delete process.env.ELECTRON_RUN_AS_NODE; else process.env.ELECTRON_RUN_AS_NODE = before; }
});

it("refuses a live unavailable descriptor without replacing or killing its process", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcw-host-unavailable-test-")); directories.push(directory);
  const descriptor = { schemaVersion: 2, pid: process.pid, instanceId: "unreachable-test", hostId: "fixture-host", url: "http://127.0.0.1:1", token: "x".repeat(43), startedAt: Date.now() };
  await writeFile(path.join(directory, "mcw-host.json"), JSON.stringify(descriptor));
  await expect(ensureHostProcess({ directory, hostId: "fixture-host", entryPath: "NEVER-START.js", terminalConfig })).rejects.toThrow(/alive but unavailable/);
  expect(await readHostDescriptor(directory)).toEqual(descriptor);
});
