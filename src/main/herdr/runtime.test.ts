// @vitest-environment node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prepareHerdrSocketDirectory, resolveHerdrPaths, startHerdrRuntime, verifyHerdrBinary } from "./runtime";

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
  it('keeps Linux socket names below sockaddr_un limits without relocating persistent state',()=>{
    const root='/home/runner/work/_temp/mcw-install-roundtrip-abcdef/v1-data-v2/host/herdr';
    const paths=resolveHerdrPaths(root,'linux');
    expect(Buffer.byteLength(paths.clientPath)).toBeLessThanOrEqual(107);
    expect(paths.config).toBe(`${root}/config`);expect(paths.state).toBe(`${root}/state`);
    expect(paths.clientPath).not.toBe(resolveHerdrPaths(`${root}-other`,'linux').clientPath);
    expect(paths.clientPath).toBe(resolveHerdrPaths(root,'linux').clientPath);
    const korean=resolveHerdrPaths('/home/'+ '사용자'.repeat(14),'linux');
    expect(Buffer.byteLength(korean.clientPath)).toBeLessThanOrEqual(107);
  });
});

it.skipIf(process.platform!=='linux')('refuses redirected, non-private or misbound short socket directories',async()=>{
  const root=await fs.mkdtemp(path.join(tmpdir(),'mcw-socket-permissions-'));
  const paths=resolveHerdrPaths(path.join(root,'long-root-'.repeat(12)),'linux');
  try{
    await prepareHerdrSocketDirectory(paths,path.join(root,'long-root-'.repeat(12)));
    await fs.chmod(paths.socketDirectory,0o755);
    await expect(prepareHerdrSocketDirectory(paths,root)).rejects.toThrow(/private/);
    await fs.chmod(paths.socketDirectory,0o700);
    await expect(prepareHerdrSocketDirectory(paths,root)).rejects.toThrow(/different runtime/);
    await fs.symlink(path.join(root,'unrelated'),paths.apiPath);
    await expect(prepareHerdrSocketDirectory(paths,path.join(root,'long-root-'.repeat(12)))).rejects.toThrow(/owned socket/);
  }finally{
    expect(paths.socketDirectory.startsWith(`/tmp/mcw-herdr-${process.getuid!()}/`)).toBe(true);
    await fs.rm(paths.socketDirectory,{recursive:true,force:true});await fs.rm(root,{recursive:true,force:true});
  }
});

describe.skipIf(!process.env.MCW_HERDR_TEST_BINARY||!process.env.MCW_BRIDGE_TEST_BINARY)("real Herdr 0.9.5", () => {
  it.each(process.platform==='linux'?['short','long']:['short'])("starts a private server, subscribes and creates an isolated session tab (%s path)", async mode => {
    const fixture = await fs.mkdtemp(path.join(tmpdir(),"mcw-herdr-"));
    const root=mode==='long'?path.join(fixture,'long-사용자-data-root-'.repeat(6)):fixture;
    await fs.mkdir(root,{recursive:true});
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
      if(mode==='long'){
        expect(Buffer.byteLength(runtime.paths.clientPath)).toBeLessThanOrEqual(107);
        // A second host observer reconnects to the same endpoint without replay.
        const attached=await startHerdrRuntime({root,binaryPath,binarySha256,bridgePath:process.env.MCW_BRIDGE_TEST_BINARY!});
        expect(attached.started).toBe(false);
      }
    } finally {
      unsubscribe?.();
      await runtime?.stop();
      const paths=resolveHerdrPaths(root);
      if(paths.socketDirectory!==paths.directory){
        expect(paths.socketDirectory.startsWith(`/tmp/mcw-herdr-${process.getuid!()}/`)).toBe(true);
        await fs.rm(paths.socketDirectory,{recursive:true,force:true});
      }
      await fs.rm(fixture,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    }
  }, 25_000);
});
