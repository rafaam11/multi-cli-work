import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { HostClient } from "../src/main/host/host-client";
import { HerdrApiClient } from "../src/main/herdr/api-client";
import { resolveHerdrPaths } from "../src/main/herdr/runtime";
import { applySurfaceEvent } from "../src/shared/herdr-surface-model";
import type { PaneSurfaceFrame, HerdrSurfaceEvent } from "../src/shared/herdr-surface-types";

test("v2 Canvas and independent host survive GUI quit and reconnect without launching a duplicate", async ({}, info) => {
  test.skip(process.env.MCW_V2_E2E !== "1", "Requires pinned v2 runtime resources; run after build:v2");
  test.setTimeout(120000);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-v2-ui-"));
  const registry = path.join(directory,"registry"), userData = path.join(directory,"user-data"), rootPath=path.join(directory,"project");
  await fs.mkdir(registry); await fs.mkdir(userData); await fs.mkdir(rootPath);
  const projectId="11111111-1111-4111-8111-111111111111", now=new Date().toISOString();
  await fs.writeFile(path.join(registry,"projects.json"),JSON.stringify({schemaVersion:1,updatedAt:now,projects:{[projectId]:{id:projectId,rootPath,displayName:"Herdr 검증",sources:["manual"],providerRefs:{claude:[],codex:[]},status:"진행중",memo:"",tracks:[],hidden:false,order:0,createdAt:now,updatedAt:now}}}));
  const env={...process.env,MCW_RUNTIME:"v2-preview",MCW_V1_REGISTRY:registry,MCW_RECOVERY_ROOT:path.join(directory,"recovery"),MULTI_CLI_WORK_USER_DATA:userData,MULTI_CLI_WORK_CODEX_SESSIONS_DIR:path.join(directory,"codex"),MULTI_CLI_WORK_CLAUDE_CONFIG_DIR:path.join(directory,"claude")};
  delete env.ELECTRON_RUN_AS_NODE;
  let app:ElectronApplication|undefined, client:HostClient|undefined;
  let observer: ReturnType<HostClient["terminalSocket"]> | undefined, surface: PaneSurfaceFrame | null = null;
  const errors:string[]=[]; let succeeded = false;
  const launch=async()=>{
    const executablePath=process.env.MCW_V2_E2E_EXECUTABLE;
    const opened=await electron.launch({...(executablePath?{executablePath,args:[]}:{args:[path.resolve("out/main/index.js")]}),env,timeout:30000});
    opened.process().stderr?.on("data",data=>errors.push(String(data)));
    opened.process().stdout?.on("data",data=>errors.push(String(data)));
    return opened;
  };
  try {
    app=await launch(); let page=await app.firstWindow();
    await expect.poll(()=>page.evaluate(()=>window.mcwV2?.version)).toBe(2);
    const descriptor=JSON.parse(await fs.readFile(path.join(`${userData}-v2`,"host/mcw-host.json"),"utf8")); client=new HostClient(descriptor);
    const session=await page.evaluate(({projectId,kind})=>window.multiCliWork.terminals.create({projectId,kind,cols:100,rows:30}),{projectId,kind:process.platform==="win32"?"powershell":"bash"});
    observer=client.terminalSocket(session.id,event=>{
      const outer=event as {snapshot?:HerdrSurfaceEvent;frame?:HerdrSurfaceEvent};const value=outer.snapshot??outer.frame;
      if(value && ["surface","patch"].includes(value.type)) surface=applySurfaceEvent(surface,value).surface;
    });
    await expect.poll(()=>client!.terminals()).toHaveLength(1);
    const row=page.locator(".session-row").first(); await expect(row).toBeVisible(); await row.click();
    await expect(page.getByRole("img",{name:"터미널 화면"})).toBeVisible();
    await page.getByRole("button",{name:"제어 요청",exact:true}).click();
    await expect(page.getByLabel("터미널 입력",{exact:true})).toHaveAttribute("aria-readonly","false");
    await page.getByLabel("터미널 입력",{exact:true}).pressSequentially("echo MCW_GUI_SURVIVES");
    await page.getByLabel("터미널 입력",{exact:true}).press("Enter");
    await expect.poll(()=>surface?.frame.cells.map(cell=>cell.symbol).join("")??"").toContain("MCW_GUI_SURVIVES");
    await page.screenshot({path:info.outputPath("canvas.png")});
    const before=await client.terminals() as {id:string;paneId:string}[];
    expect(before[0].id).toBe(session.id);
    const firstProcess=app.process(); await app.evaluate(({app})=>app.quit()); await expect.poll(()=>firstProcess.exitCode).not.toBe(null); app=undefined;
    expect((await client.terminals() as {id:string}[])[0].id).toBe(session.id);
    app=await launch();page=await app.firstWindow();
    await expect.poll(()=>page.evaluate(()=>window.multiCliWork.terminals.list())).toEqual(expect.arrayContaining([expect.objectContaining({id:session.id,pid:0})]));
    const after=await client.terminals() as {id:string;paneId:string}[];expect(after).toHaveLength(1);expect(after[0].paneId).toBe(before[0].paneId);
    expect(await fs.readFile(path.join(registry,"projects.json"),"utf8")).toContain("Herdr 검증");
    await expect(fs.access(path.join(directory,`recovery/v1.55.1-recovery/recover.${process.platform==="win32"?"cmd":"sh"}`))).resolves.toBeUndefined();
    succeeded = true;
  } catch (error) {
    console.error("v2 Electron main stderr:", errors.join(""));
    console.error("v2 startup fixture entries:", await fs.readdir(userData).catch(()=>[]), await fs.readdir(`${userData}-v2`).catch(()=>[]), await fs.readdir(path.join(directory,"recovery")).catch(()=>[]));
    throw error;
  } finally {
    observer?.close();
    if(app){const child=app.process();await app.evaluate(({app})=>app.quit()).catch(()=>undefined);await expect.poll(()=>child.exitCode,{timeout:10000}).not.toBe(null);}
    if(client){for(const session of await client.terminals() as {id:string}[])await client.stopTerminal(session.id);await client.shutdown();}
    await new HerdrApiClient(resolveHerdrPaths(path.join(`${userData}-v2`,"host/herdr")).endpoint).request("server.stop",{}).catch(()=>undefined);
    await fs.writeFile(info.outputPath("main-stderr.txt"),errors.join(""));
    // Preserve fixture and evidence on failure; cleanup only our own successful test directory.
    if(succeeded)await fs.rm(directory,{recursive:true,force:true,maxRetries:15,retryDelay:100});
    else await info.attach("fixture",{body:directory,contentType:"text/plain"});
  }
});
