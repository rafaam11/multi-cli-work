// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createHerdrTerminalService, parseLaunchSpec } from "./terminal-service";
import { HerdrApiClient } from "./api-client";
import { resolveHerdrPaths } from "./runtime";
import { encodeChipsMetadata } from "../../shared/herdr-metadata";
import { metadataArgv } from "../../../mods/mcw-chips-v2/hooks/metadata";

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
      const api=new HerdrApiClient(resolveHerdrPaths(path.join(root,"herdr")).endpoint);
      const tokens=encodeChipsMetadata({chips:[{key:"test",text:"테스트 완료 ✓",color:"green"}],progress:null},["test"]);
      const statusBefore=(await service.list())[0].status;
      await api.request("pane.report_metadata",{pane_id:session.paneId,source:"mcw-chips-v2",tokens,ttl_ms:60_000});
      await expect.poll(async()=>(await service.list())[0].tokens).toEqual({"mcw-test":"green|테스트 완료 ✓"});
      expect((await service.list())[0].status).toBe(statusBefore);
      await api.request("pane.report_metadata",{pane_id:session.paneId,source:"mcw-chips-v2",tokens:{"mcw-test":null}});
      await expect.poll(async()=>(await service.list())[0].tokens).toEqual({});
      const native=metadataArgv(binaryPath,session.paneId!,{chips:{test:{text:'한글 $(literal); "quote"',color:"blue"}},progress:{kind:"value",value:50}});
      await promisify(execFile)(native[0],native.slice(1),{windowsHide:true,timeout:10000,env:{...process.env,HERDR_SOCKET_PATH:resolveHerdrPaths(path.join(root,"herdr")).apiPath}});
      await expect.poll(async()=>(await service.list())[0].tokens).toEqual({"mcw-test":'blue|한글 $(literal); "quote"',"mcw-progress":"normal|50"});
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
      const next=await service.create({...spec,sessionId:"session-2"});
      expect(next.delivery).toBe("delivered");
      await service.stop("session-2");
      const checkedAfter=Date.now();await service.refreshObservation();
      expect((await service.list()).every(session=>session.status==="exited"&&session.connected&&session.observedAt!>=checkedAfter)).toBe(true);
    } finally { await service.close(true); await fs.rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
  },40_000);
});
