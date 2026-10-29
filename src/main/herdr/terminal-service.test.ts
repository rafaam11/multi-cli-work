// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHerdrTerminalService, parseLaunchSpec } from "./terminal-service";

describe("Herdr session admission", () => {
  it("rejects relative workspaces and control environment injection", () => {
    const spec = {sessionId:"session-1",kind:"powershell",cwd:path.resolve("."),executable:"powershell.exe",args:[],env:{},projectId:null,createdAt:new Date().toISOString()};
    expect(parseLaunchSpec(spec).sessionId).toBe("session-1");
    expect(parseLaunchSpec({...spec,env:{"ProgramFiles(x86)":"C:\\Program Files (x86)"}}).env).toHaveProperty("ProgramFiles(x86)");
    expect(() => parseLaunchSpec({...spec,cwd:"../"})).toThrow("absolute");
    expect(() => parseLaunchSpec({...spec,env:{HERDR_SOCKET_PATH:"other"}})).toThrow("reserved");
    expect(() => parseLaunchSpec({...spec,env:{MULTI_CLI_WORK_CONTROL_TOKEN:"old"}})).toThrow("reserved");
    expect(() => parseLaunchSpec({...spec,args:[42]})).toThrow("arguments");
  });
});

describe.skipIf(!process.env.MCW_HERDR_TEST_BINARY || !process.env.MCW_BRIDGE_TEST_BINARY)("real terminal service", () => {
  it("retains work across viewer disconnects, enforces one size owner and never relaunches an id", async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(),"mcw-broker-"));
    const binaryPath = process.env.MCW_HERDR_TEST_BINARY!;
    const binarySha256 = createHash("sha256").update(await fs.readFile(binaryPath)).digest("hex");
    const service = await createHerdrTerminalService({root,binaryPath,binarySha256,bridgePath:process.env.MCW_BRIDGE_TEST_BINARY!});
    try {
      const spec = {sessionId:"session-1",kind:"powershell",cwd:root,executable:process.platform==="win32"?"powershell.exe":"bash",args:process.platform==="win32"?["-NoLogo","-NoProfile","-NoExit"]:[],env:{},projectId:null,createdAt:new Date().toISOString()};
      const session = await service.create(spec);
      expect(session.paneId).toBeTruthy();
      const snapshot = await service.snapshot("session-1");
      expect(snapshot.type).toBe("surface");
      await expect(service.resize("session-1","observer",40,10)).rejects.toThrow("control");
      await service.takeOwnership("session-1","desktop");
      await expect(service.takeOwnership("session-1","phone")).rejects.toThrow("owned");
      await service.resize("session-1","desktop",40,10);
      await service.input("session-1","desktop",{TextCommit:"echo MCW_OWNED_SESSION"});
      await service.input("session-1","desktop",{Key:{code:"Enter",modifiers:0,kind:"Press",repeat_count:1,shifted_codepoint:null,generated_text:null,tracks_release:false,physical_key_id:null,windows_record:null}});
      await service.releaseOwnership("session-1","desktop");
      await expect(service.create(spec)).rejects.toThrow("already");
      const terminals = await service.list();
      expect(terminals).toHaveLength(1);
      expect(terminals[0]).toMatchObject({id:"session-1",paneId:session.paneId});
      const until = Date.now()+8000;
      for (;;) {
        const frame = await service.snapshot("session-1");
        const text = frame.surface.frame.cells.map(cell => cell.symbol).join("");
        if (text.includes("MCW_OWNED_SESSION")) break;
        if(Date.now()>until) throw new Error("semantic input was not rendered");
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      await service.stop("session-1");
    } finally { await service.close(true); await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
  },40_000);
});
