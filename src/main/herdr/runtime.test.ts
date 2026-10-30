// @vitest-environment node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveHerdrPaths, startHerdrRuntime, verifyHerdrBinary } from "./runtime";

describe("managed Herdr runtime", () => {
  it("rejects a changed binary before spawning it", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(),"mcw-pin-"));
    try {
      const binary = path.join(dir,"herdr");
      await fs.writeFile(binary,"never execute this");
      await expect(verifyHerdrBinary(binary,"0".repeat(64))).rejects.toThrow("SHA-256");
      await expect(verifyHerdrBinary(binary,createHash("sha256").update("never execute this").digest("hex"))).resolves.toBeUndefined();
    } finally { await fs.rm(dir,{recursive:true,force:true}); }
  });
  it("uses an isolated named session, never the user's default Herdr session", () => {
    const paths = resolveHerdrPaths("C:\\mcw-v2", "win32");
    expect(paths.apiPath).toBe("C:\\mcw-v2\\config\\herdr\\sessions\\mcw-v2\\herdr.sock");
    expect(paths.endpoint).toBe("\\\\.\\pipe\\C:\\mcw-v2\\config\\herdr\\sessions\\mcw-v2\\herdr.sock");
    expect(resolveHerdrPaths("/tmp/mcw", "linux").endpoint).toBe("/tmp/mcw/config/herdr/sessions/mcw-v2/herdr.sock");
  });
});

describe.skipIf(!process.env.MCW_HERDR_TEST_BINARY||!process.env.MCW_BRIDGE_TEST_BINARY)("real Herdr 0.9.5", () => {
  it("starts a private server, subscribes and creates an isolated session tab", async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(),"mcw-herdr-"));
    const binaryPath = process.env.MCW_HERDR_TEST_BINARY!;
    const binarySha256 = createHash("sha256").update(await fs.readFile(binaryPath)).digest("hex");
    let runtime: Awaited<ReturnType<typeof startHerdrRuntime>> | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      runtime = await startHerdrRuntime({root,binaryPath,binarySha256,bridgePath:process.env.MCW_BRIDGE_TEST_BINARY!});
      expect((await runtime.api.request("ping",{})).version).toBe(process.platform==="win32"?"0.9.5-mcw.1":"0.9.5");
      const events: unknown[] = [];
      unsubscribe = await runtime.api.subscribe(["workspace.created"], event => events.push(event), () => {});
      const result = await runtime.api.request("workspace.create",{cwd:root,label:"MCW TEST",focus:false});
      expect(result.type).toBe("workspace_created");
      expect(await fs.realpath((result.root_pane as {cwd:string}).cwd)).toBe(await fs.realpath(root));
      await new Promise(resolve => setTimeout(resolve,250));
      expect(events.length).toBeGreaterThan(0);
      const snapshot = await runtime.api.request("session.snapshot",{});
      expect(snapshot.type).toBe("session_snapshot");
    } finally {
      unsubscribe?.();
      await runtime?.stop();
      await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    }
  }, 25_000);
});
