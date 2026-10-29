import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import { HostClient } from "../src/main/host/host-client";
import { HerdrApiClient } from "../src/main/herdr/api-client";
import { resolveHerdrPaths } from "../src/main/herdr/runtime";
import { ensureHostProcess } from "../src/main/host/host-process";
import { applySurfaceEvent } from "../src/shared/herdr-surface-model";
import type { PaneSurfaceFrame, HerdrSurfaceEvent } from "../src/shared/herdr-surface-types";

test("v2 Canvas and independent host survive GUI quit and reconnect without launching a duplicate", async ({}, info) => {
  test.skip(process.env.MCW_V2_E2E !== "1", "Requires pinned v2 runtime resources; run after build:v2");
  test.setTimeout(120000);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-v2-ui-"));
  const registry = path.join(directory,"registry"), userData = path.join(directory,"user-data"), rootPath=path.join(directory,"project");
  await fs.mkdir(registry); await fs.mkdir(userData); await fs.mkdir(rootPath);
  const claudeConfig=path.join(directory,"claude"),v1Mod=path.join(claudeConfig,"plugins/cache/jinmin/mcw-chips/0.1.0");
  await fs.mkdir(path.join(v1Mod,".claude-plugin"),{recursive:true});
  await fs.writeFile(path.join(v1Mod,".claude-plugin/plugin.json"),'{"name":"mcw-chips","version":"0.1.0"}');
  await fs.writeFile(path.join(v1Mod,"v1-source.txt"),"v1 mod original\r\n");
  await fs.writeFile(path.join(claudeConfig,"settings.json"),'{"enabledPlugins":{"mcw-chips@jinmin":true}}');
  await fs.writeFile(path.join(claudeConfig,"plugins/installed_plugins.json"),JSON.stringify({plugins:{"mcw-chips@jinmin":[{installPath:v1Mod}]}}));
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
    page.on("pageerror",error=>errors.push(`renderer: ${error.message}`));
    await expect.poll(()=>page.evaluate(()=>window.mcwV2?.version)).toBe(2);
    const descriptor=JSON.parse(await fs.readFile(path.join(`${userData}-v2`,"host/mcw-host.json"),"utf8")); client=new HostClient(descriptor);
    const recovery=path.join(directory,"recovery/v1.55.1-recovery"),modBackup=path.join(directory,"recovery/v1-mods-before-v2");
    const proof=await promisify(execFile)(path.join(recovery,process.platform==="win32"?"recovery-node.exe":"recovery-node"),[path.join(recovery,"recover.mjs"),"verify-mods",modBackup],{windowsHide:true,timeout:10000});
    expect(JSON.parse(proof.stdout).entries.some((entry:{path:string})=>entry.path.endsWith("/v1-source.txt"))).toBe(true);
    expect(await fs.readFile(path.join(v1Mod,"v1-source.txt"),"utf8")).toBe("v1 mod original\r\n");
    await page.getByRole("menuitem",{name:"설정",exact:true}).click();
    const settings=page.getByRole("dialog",{name:"설정",exact:true});
    await expect(settings.getByLabel(/jk 도구/)).toHaveCount(0);
    const shipped=await page.evaluate(()=>window.multiCliWork.presets.list());expect(JSON.stringify(shipped)).not.toMatch(/\bjk\b/);
    await page.evaluate(()=>window.multiCliWork.presets.save({id:"custom-v1",name:"내 프리셋",members:[{agentId:"claude",name:"대표",prompt:"jk post 원문 보존"}]}));
    const refused=await page.evaluate(async projectId=>{try{await window.multiCliWork.presets.launch({presetId:"custom-v1",projectId});return "unexpected launch";}catch(error){return String(error);}},projectId);
    expect(refused).toContain("이관 필요");expect(await client.tasks()).toEqual([]);expect(await client.terminals()).toEqual([]);
    await settings.getByRole("button",{name:"팀 프리셋",exact:true}).click();await expect(settings.getByText(/이관 필요: 역할 프롬프트/)).toBeVisible();await page.screenshot({path:info.outputPath("preset-migration.png")});
    await settings.getByRole("button",{name:"원격",exact:true}).click();
    await expect(settings.getByText(`이 PC: ${descriptor.hostId}`)).toBeVisible();
    const connectionInfo=await page.evaluate(()=>window.mcwV2!.localConnection!());expect(connectionInfo.hostId).toBe(descriptor.hostId);expect(connectionInfo).not.toHaveProperty("token");
    await settings.getByLabel("SSH 주소",{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath("host-settings.png")});
    await page.keyboard.press("Escape");
    const session=await page.evaluate(({projectId,kind})=>window.multiCliWork.terminals.create({projectId,kind,cols:100,rows:30}),{projectId,kind:process.platform==="win32"?"powershell":"bash"});
    observer=client.terminalSocket(session.id,event=>{
      const outer=event as {snapshot?:HerdrSurfaceEvent;frame?:HerdrSurfaceEvent};const value=outer.snapshot??outer.frame;
      if(value && ["surface","patch"].includes(value.type)) surface=applySurfaceEvent(surface,value).surface;
    });
    await expect.poll(()=>client!.terminals()).toHaveLength(1);
    const row=page.locator(".session-row").first(); await expect(row).toBeVisible(); await row.click();
    await expect(row).toContainText("상태 미확인");
    await expect(page.getByRole("img",{name:"터미널 화면"})).toBeVisible();
    await page.getByRole("button",{name:"제어 요청",exact:true}).click();
    await expect(page.getByLabel("터미널 입력",{exact:true})).toHaveAttribute("aria-readonly","false");
    await page.getByLabel("터미널 입력",{exact:true}).pressSequentially("echo MCW_GUI_SURVIVES");
    await page.getByLabel("터미널 입력",{exact:true}).press("Enter");
    await expect.poll(()=>surface?.frame.cells.map(cell=>cell.symbol).join("")??"").toContain("MCW_GUI_SURVIVES");
    await page.screenshot({path:info.outputPath("canvas.png")});
    const before=await client.terminals() as {id:string;paneId:string}[];
    expect(before[0].id).toBe(session.id);
    const herdrApi=new HerdrApiClient(resolveHerdrPaths(path.join(`${userData}-v2`,"host/herdr")).endpoint);
    await herdrApi.request("pane.report_metadata",{pane_id:before[0].paneId,source:"mcw-chips-v2",tokens:{"mcw-test":"green|검증 완료","mcw-progress":"normal|40"},ttl_ms:60000});
    await expect(page.getByTestId("pane-chip").filter({hasText:"검증 완료"})).toBeVisible();
    await page.screenshot({path:info.outputPath("herdr-metadata.png")});
    const firstProcess=app.process(); await app.evaluate(({app})=>app.quit()); await expect.poll(()=>firstProcess.exitCode).not.toBe(null); app=undefined;
    expect((await client.terminals() as {id:string}[])[0].id).toBe(session.id);
    app=await launch();page=await app.firstWindow();
    await expect(page.getByTestId("pane-chip").filter({hasText:"검증 완료"})).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>window.multiCliWork.terminals.list())).toEqual(expect.arrayContaining([expect.objectContaining({id:session.id,pid:0})]));
    const after=await client.terminals() as {id:string;paneId:string}[];expect(after).toHaveLength(1);expect(after[0].paneId).toBe(before[0].paneId);
    // Crash only the authenticated host created inside this test fixture. Herdr and the shell
    // remain independent; the explicit restart must recover observation without rerunning work.
    await page.locator(".session-row").first().click();
    await expect(page.getByRole("img",{name:"터미널 화면"})).toBeVisible();
    await page.getByRole("button",{name:"제어 요청",exact:true}).click();
    await expect(page.getByLabel("터미널 입력",{exact:true})).toHaveAttribute("aria-readonly","false");
    expect((await client.health()).instanceId).toBe(descriptor.instanceId);
    process.kill(descriptor.pid,"SIGKILL");
    await expect(page.getByText(/연결 끊김 · 마지막 관찰/)).toBeVisible();
    await expect(page.getByLabel("터미널 입력",{exact:true})).toHaveAttribute("aria-readonly","true");
    await expect.poll(()=>{try{process.kill(descriptor.pid,0);return true;}catch{return false;}}).toBe(false);
    const executable=process.env.MCW_V2_E2E_EXECUTABLE;
    const resourcesDirectory=executable?path.join(path.dirname(executable),"resources/v2"):path.resolve("build/v2");
    const bridgeDirectory=executable?path.join(path.dirname(executable),"resources/herdr-bridge"):path.resolve(`build/herdr-bridge/${process.platform}-${process.arch}`);
    const manifest=JSON.parse(await fs.readFile(path.join(resourcesDirectory,"assets.json"),"utf8"));
    const windows=process.platform==="win32";
    const restarted=await ensureHostProcess({directory:path.join(`${userData}-v2`,"host"),hostId:descriptor.hostId,entryPath:path.join(resourcesDirectory,"host/mcw-host.js"),executablePath:path.join(resourcesDirectory,windows?"node/windows/node.exe":"node/linux/node"),electronExecutable:false,terminalConfig:{binaryPath:path.join(resourcesDirectory,windows?"herdr/windows/herdr.exe":"herdr/herdr-linux-x86_64"),binarySha256:windows?manifest.windowsMembers.find((entry:{file:string})=>entry.file==="herdr.exe").sha256:manifest.assets.find((entry:{id:string})=>entry.id==="herdr-linux").sha256,bridgePath:path.join(bridgeDirectory,windows?"mcw-herdr-bridge.exe":"mcw-herdr-bridge")}});
    client=new HostClient(restarted);
    await expect(page.getByRole("button",{name:"제어 요청",exact:true})).toBeEnabled({timeout:30000});
    await expect(page.getByLabel("터미널 입력",{exact:true})).toHaveAttribute("aria-readonly","true");
    await page.getByRole("button",{name:"제어 요청",exact:true}).click();
    await expect(page.getByLabel("터미널 입력",{exact:true})).toHaveAttribute("aria-readonly","false");
    const recovered=await client.terminals() as {id:string;paneId:string}[];
    expect(recovered).toHaveLength(1);expect(recovered[0].paneId).toBe(before[0].paneId);
    expect(await fs.readFile(path.join(registry,"projects.json"),"utf8")).toContain("Herdr 검증");
    await expect(fs.access(path.join(directory,`recovery/v1.55.1-recovery/recover.${process.platform==="win32"?"cmd":"sh"}`))).resolves.toBeUndefined();
    succeeded = true;
  } catch (error) {
    if(app)for(const window of app.windows()) console.error("v2 renderer diagnostic:",await window.evaluate(()=>document.body.innerText).catch(()=>null));
    console.error("v2 scenario failure:",error);
    console.error("v2 Electron main stderr:", errors.join(""));
    console.error("v2 startup fixture entries:", await fs.readdir(userData).catch(()=>[]), await fs.readdir(`${userData}-v2`).catch(()=>[]), await fs.readdir(path.join(directory,"recovery")).catch(()=>[]));
    throw error;
  } finally {
    observer?.close();
    if(app){const child=app.process();await app.evaluate(({app})=>app.quit()).catch(()=>undefined);await expect.poll(()=>child.exitCode,{timeout:10000}).not.toBe(null);}
    try {
      if(client){for(const session of await client.terminals() as {id:string}[])await client.stopTerminal(session.id);await client.shutdown();}
    } catch(error) { console.error("Fixture host cleanup:",error); }
    finally { await new HerdrApiClient(resolveHerdrPaths(path.join(`${userData}-v2`,"host/herdr")).endpoint).request("server.stop",{}).catch(()=>undefined); }
    await fs.writeFile(info.outputPath("main-stderr.txt"),errors.join(""));
    // Preserve fixture and evidence on failure; cleanup only our own successful test directory.
    if(succeeded)await fs.rm(directory,{recursive:true,force:true,maxRetries:15,retryDelay:100});
    else await info.attach("fixture",{body:directory,contentType:"text/plain"});
  }
});
