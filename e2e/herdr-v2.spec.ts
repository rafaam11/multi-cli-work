import { _electron as electron, chromium, expect, test, type ElectronApplication } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import { HostClient } from "../src/main/host/host-client";
import { HerdrApiClient } from "../src/main/herdr/api-client";
import { resolveHerdrPaths } from "../src/main/herdr/runtime";
import { ensureHostProcess } from "../src/main/host/host-process";
import {resolveHerdrResource} from "../src/main/v2/herdr-resource";
import { TaskStore } from "../src/main/host/task-store";
import { applySurfaceEvent } from "../src/shared/herdr-surface-model";
import type { PaneSurfaceFrame, HerdrSurfaceEvent } from "../src/shared/herdr-surface-types";
import {exerciseRecoveryHold} from './recovery-hold';
import {exerciseOfflineRecovery} from './recovery-offline';
import {RemoteDeviceStore} from '../src/main/remote/device-store';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {openMobileHostBrowser} from './mobile-host-browser';

test("v2 Canvas and independent host survive GUI quit and reconnect without launching a duplicate", async ({}, info) => {
  test.skip(process.env.MCW_V2_E2E !== "1", "Requires pinned v2 runtime resources; run after build:v2");
  test.setTimeout(120000);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-v2-ui-"));
  const registry = path.join(directory,"registry"), userData = path.join(directory,"user-data"), rootPath=path.join(directory,"project");
  await fs.mkdir(registry); await fs.mkdir(userData); await fs.mkdir(rootPath);
  const pairings=new RemoteDeviceStore(path.join(userData,'remote-devices.json'));
  const legacyPair=await pairings.register('기존 폰');const legacyHostId=await pairings.hostId();
  const portProbe=createServer();await new Promise<void>(resolve=>portProbe.listen(0,'127.0.0.1',resolve));
  const mobilePort=(portProbe.address() as import('node:net').AddressInfo).port;await new Promise<void>((resolve,reject)=>portProbe.close(error=>error?reject(error):resolve()));
  await fs.writeFile(path.join(userData,'settings.json'),JSON.stringify({remote:{enabled:true,port:mobilePort}}));
  const git=(...args:string[])=>promisify(execFile)("git",["-C",rootPath,...args],{windowsHide:true,timeout:10000});
  await git("init");await fs.writeFile(path.join(rootPath,"fixture.txt"),"MCW isolated checkout\n");await git("add",".");
  await git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-m","fixture");
  const fixtureHead=(await git("rev-parse","HEAD")).stdout.trim();
  const claudeConfig=path.join(directory,"claude"),v1Mod=path.join(claudeConfig,"plugins/cache/jinmin/mcw-chips/0.1.0");
  await fs.mkdir(path.join(v1Mod,".claude-plugin"),{recursive:true});
  await fs.writeFile(path.join(v1Mod,".claude-plugin/plugin.json"),'{"name":"mcw-chips","version":"0.1.0"}');
  await fs.writeFile(path.join(v1Mod,"v1-source.txt"),"v1 mod original\r\n");
  await fs.writeFile(path.join(claudeConfig,"settings.json"),'{"enabledPlugins":{"mcw-chips@jinmin":true}}');
  await fs.writeFile(path.join(claudeConfig,"plugins/installed_plugins.json"),JSON.stringify({plugins:{"mcw-chips@jinmin":[{installPath:v1Mod}]}}));
  const projectId="11111111-1111-4111-8111-111111111111", now=new Date().toISOString();
  await fs.writeFile(path.join(registry,"projects.json"),JSON.stringify({schemaVersion:1,updatedAt:now,projects:{[projectId]:{id:projectId,rootPath,displayName:"Herdr 검증",sources:["manual"],providerRefs:{claude:[],codex:[]},status:"진행중",memo:"",tracks:[],hidden:false,order:0,createdAt:now,updatedAt:now}}}));
  const workProjectId="22222222-2222-4222-8222-222222222222";
  await fs.writeFile(path.join(registry,"work-projects.json"),JSON.stringify({schemaVersion:1,updatedAt:now,teamsSyncRoot:null,workProjects:{[workProjectId]:{id:workProjectId,name:"협업 검증 프로젝트",category:"work",status:null,memo:"보존할 프로젝트 메모",notionLinks:[],localFolders:[],members:[{projectId,role:"repo"}],order:0,createdAt:now,updatedAt:now}}}));
  const env:NodeJS.ProcessEnv={...process.env,MCW_RUNTIME:process.env.MCW_V2_E2E_RUNTIME??"v2-preview",MCW_V1_REGISTRY:registry,MCW_RECOVERY_ROOT:path.join(directory,"recovery"),MULTI_CLI_WORK_USER_DATA:userData,MULTI_CLI_WORK_REMOTE_BIND:'127.0.0.1',MULTI_CLI_WORK_CODEX_SESSIONS_DIR:path.join(directory,"codex"),MULTI_CLI_WORK_CLAUDE_CONFIG_DIR:path.join(directory,"claude")};
  delete env.ELECTRON_RUN_AS_NODE;
  let app:ElectronApplication|undefined, client:HostClient|undefined;
  let observer: ReturnType<HostClient["terminalSocket"]> | undefined, surface: PaneSurfaceFrame | null = null;
  let mobile:Awaited<ReturnType<typeof openMobileHostBrowser>>|undefined;
  const errors:string[]=[]; let succeeded = false;
  const launch=async()=>{
    const executablePath=process.env.MCW_V2_E2E_EXECUTABLE;
    const opened=await electron.launch({...(executablePath?{executablePath,args:[]}:{args:[path.resolve("out/main/index.js")]}),env:Object.fromEntries(Object.entries(env).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),timeout:30000});
    opened.process().stderr?.on("data",data=>errors.push(String(data)));
    opened.process().stdout?.on("data",data=>errors.push(String(data)));
    return opened;
  };
  try {
    app=await launch(); let page=await app.firstWindow();
    if(process.env.MCW_V2_E2E_RUNTIME==='v2')expect(await app.evaluate(({app})=>app.getVersion())).toBe(JSON.parse(await fs.readFile(path.resolve("package.json"),"utf8")).version);
    page.on("pageerror",error=>errors.push(`renderer: ${error.message}`));
    await expect.poll(()=>page.evaluate(()=>window.mcwV2?.version)).toBe(2);
    const descriptor=JSON.parse(await fs.readFile(path.join(`${userData}-v2`,"host/mcw-host.json"),"utf8")); client=new HostClient(descriptor);
    const catalog=await client.request<import("../src/shared/execution-catalog").ExecutionCatalog>("/execution-catalog");
    expect(catalog.hostId).toBe(descriptor.hostId);expect(catalog.repositories.find(repo=>repo.id===projectId)?.path).toBe(rootPath);
    const inspected=await client.request<import("../src/shared/execution-catalog").RepositoryInspection>(`/execution-catalog/repositories/${projectId}`);
    expect(inspected.expectedHead).toBe(fixtureHead);expect(inspected.repository.id).toBe(projectId);
    expect((await git("status","--porcelain")).stdout.trim()).toBe("");
    const recovery=JSON.parse(await fs.readFile(path.join(directory,'recovery/active-runtime.json'),'utf8')).directory as string,modBackup=path.join(directory,"recovery/v1-mods-before-v2");
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
    await page.getByRole("button",{name:"협업 검증 프로젝트 프로젝트 열기",exact:true}).click();
    const taskPanel=page.getByRole("region",{name:"협업 작업",exact:true});
    await taskPanel.getByRole("button",{name:"작업자 추가",exact:true}).click();
    await expect(taskPanel.getByLabel("작업자 1 실행 PC",{exact:true})).toHaveValue("");
    await expect(taskPanel.getByLabel("작업자 1 실행 PC",{exact:true})).toContainText("대표와 같은 PC");
    await taskPanel.screenshot({path:info.outputPath("task-worker-selection.png")});
    const session=await page.evaluate(({projectId,kind})=>window.multiCliWork.terminals.create({projectId,kind,cols:100,rows:30}),{projectId,kind:process.platform==="win32"?"powershell":"bash"});
    observer=client.terminalSocket(session.id,event=>{
      const outer=event as {snapshot?:HerdrSurfaceEvent;frame?:HerdrSurfaceEvent};const value=outer.snapshot??outer.frame;
      if(value && ["surface","patch"].includes(value.type)) surface=applySurfaceEvent(surface,value).surface;
    });
    await expect.poll(()=>client!.terminals()).toHaveLength(1);
    const row=page.locator(".session-row").first(); await expect(row).toBeVisible(); await row.getByRole('button',{name:/패인 열기/}).click();
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
    expect(await new RemoteDeviceStore(path.join(`${userData}-v2`,'remote-devices.json')).hostId()).toBe(legacyHostId);
    mobile=await openMobileHostBrowser({client,pairing:{token:legacyPair.token,deviceId:legacyPair.device.deviceId,hostName:'검증 PC'},sessionId:session.id,info});
    await expect(page.getByLabel('터미널 입력',{exact:true})).toHaveAttribute('aria-readonly','false');
    await exerciseRecoveryHold({directory,recovery,userData,registry,app,page,client,info});
    const firstProcess=app.process(); await app.evaluate(({app})=>app.quit()); await expect.poll(()=>firstProcess.exitCode).not.toBe(null); app=undefined;
    await mobile.afterGuiQuit(()=>surface?.frame.cells.map(cell=>cell.symbol).join('')??'');
    expect((await client.terminals() as {id:string}[])[0].id).toBe(session.id);
    app=await launch();page=await app.firstWindow();
    await expect(page.getByTestId("pane-chip").filter({hasText:"검증 완료"})).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>window.multiCliWork.terminals.list())).toEqual(expect.arrayContaining([expect.objectContaining({id:session.id,pid:0})]));
    const after=await client.terminals() as {id:string;paneId:string}[];expect(after).toHaveLength(1);expect(after[0].paneId).toBe(before[0].paneId);
    // Crash only the authenticated host created inside this test fixture. Herdr and the shell
    // remain independent; the explicit restart must recover observation without rerunning work.
    await page.getByRole('region',{name:'세션 패널',exact:true}).getByRole('button',{name:/패인 열기/}).first().click();
    await expect(page.getByRole("img",{name:"터미널 화면"})).toBeVisible();
    await page.getByRole("button",{name:"제어 요청",exact:true}).click();
    await expect(page.getByLabel("터미널 입력",{exact:true})).toHaveAttribute("aria-readonly","false");
    expect((await client.health()).instanceId).toBe(descriptor.instanceId);
    // Seed only this disposable host's last observation. The remote connection
    // stays disabled; this checks offline UI without contacting a real PC.
    const remoteId="offline-fixture",remoteStore=new TaskStore({directory:path.join(directory,"remote-fixture"),hostId:remoteId});
    const remoteProjectId='33333333-3333-4333-8333-333333333333';
    const remoteRepositoryId='remote-repo-fixture',remoteSessionId='remote-worker-fixture';
    const remoteTask=await remoteStore.createTask({title:"원격 결과 보존",brief:"연결이 끊겨도 검증 결과를 보존합니다.",projectId:remoteProjectId,lead:{provider:"claude",profileId:"fixture",hostId:remoteId},workers:[]});
    const remoteIdentity=await remoteStore.bind({taskId:remoteTask.id,participantId:remoteTask.participants[0].id,attemptId:remoteTask.participants[0].attempt.id,generation:1});
    await remoteStore.submitResult(remoteIdentity,{summary:"사용자 확인 전 결과",changes:[],verification:["원격 검증 근거"],artifacts:[],issues:[]});
    await client.request("/hosts","POST",{name:"검증 PC",enabled:false,ssh:{hostId:remoteId,destination:"unconnected.invalid",platform:"linux",nodeExecutable:"/fixture/node",hostEntrypoint:"/fixture/host.js",dataRoot:"/fixture/data"}});
    await fs.writeFile(path.join(`${userData}-v2`,"host/host-observations.json"),JSON.stringify({version:2,observations:[{hostId:remoteId,platform:"linux",observedAt:Date.now(),tasks:await remoteStore.list(),terminals:[{id:remoteSessionId,kind:'codex',cwd:'/fixture/project-wt/worker',projectId:remoteRepositoryId,createdAt:now,generation:'fixture-generation',tabId:'fixture-tab',paneId:'fixture-pane',delivery:'delivered',status:'unknown',observedAt:Date.now(),connected:false}],catalog:{version:1,hostId:remoteId,platform:'linux',launchProfiles:[],defaultLaunchProfiles:{},availableProviders:[],repositories:[{id:remoteRepositoryId,name:'원격 저장소',path:'/fixture/project',projectId:remoteProjectId,projectName:'원격 검증 프로젝트'}]}}]}));
    process.kill(descriptor.pid,"SIGKILL");
    await expect(page.getByText(/연결 끊김 · 마지막 관찰/)).toBeVisible();
    await expect(page.getByLabel("터미널 입력",{exact:true})).toHaveAttribute("aria-readonly","true");
    await expect.poll(()=>{try{process.kill(descriptor.pid,0);return true;}catch{return false;}}).toBe(false);
    const {resourcesDirectory,bridgeDirectory}=JSON.parse(await fs.readFile(path.join(directory,'recovery/active-host-runtime.json'),'utf8')) as {resourcesDirectory:string;bridgeDirectory:string};
    const windows=process.platform==="win32";
    const layout={userData:`${userData}-v2`,registry:`${registry}-v2`};
    const restarted=await ensureHostProcess({directory:path.join(`${userData}-v2`,"host"),hostId:descriptor.hostId,entryPath:path.join(resourcesDirectory,"host/mcw-host.js"),executablePath:path.join(resourcesDirectory,windows?"node/windows/node.exe":"node/linux/node"),electronExecutable:false,catalogPaths:{userData:layout.userData,registryRoot:layout.registry},mobileConfig:{userData:layout.userData,rendererDir:path.join(resourcesDirectory,'mobile'),bindOverride:'127.0.0.1'},terminalConfig:{...await resolveHerdrResource(resourcesDirectory),bridgePath:path.join(bridgeDirectory,windows?"mcw-herdr-bridge.exe":"mcw-herdr-bridge")}});
    client=new HostClient(restarted);
    await expect(page.getByRole("button",{name:"제어 요청",exact:true})).toBeEnabled({timeout:30000});
    await expect(page.getByLabel("터미널 입력",{exact:true})).toHaveAttribute("aria-readonly","true");
    await page.getByRole("button",{name:"제어 요청",exact:true}).click();
    await expect(page.getByLabel("터미널 입력",{exact:true})).toHaveAttribute("aria-readonly","false");
    const recovered=await client.terminals() as {id:string;paneId:string}[];
    expect(recovered).toHaveLength(1);expect(recovered[0].paneId).toBe(before[0].paneId);
    await page.getByRole("menuitem",{name:"설정",exact:true}).click();
    const reopenedSettings=page.getByRole("dialog",{name:"설정",exact:true});
    await reopenedSettings.getByRole("button",{name:"원격",exact:true}).click();
    await reopenedSettings.getByRole("button",{name:"검증 PC 작업·결과 보기"}).click();
    await reopenedSettings.getByRole("button",{name:/원격 결과 보존/}).click();
    await expect(reopenedSettings.getByText("사용자 확인 전 결과",{exact:true}).first()).toBeVisible();
    await expect(reopenedSettings.getByRole("button",{name:"결과 확인",exact:true})).toBeDisabled();
    await expect(reopenedSettings.getByRole("button",{name:"메시지 보내기",exact:true})).toBeDisabled();
    await expect(reopenedSettings.getByText(/호스트 연결 끊김 · 마지막 수신/)).toBeVisible();
    await expect(reopenedSettings.getByText(/Error invoking remote method/)).toHaveCount(0);
    await reopenedSettings.locator(".v2-remote-tasks").screenshot({path:info.outputPath("remote-task-offline.png")});
    await page.keyboard.press("Escape");
    await page.evaluate(({workProjectId,remoteId,remoteProjectId})=>window.multiCliWork.workProjects.update(workProjectId,{hostProjects:[{hostId:remoteId,projectId:remoteProjectId,projectName:'원격 검증 프로젝트'}]}),{workProjectId,remoteId,remoteProjectId});
    await page.reload();
    await page.getByRole('button',{name:'협업 검증 프로젝트 프로젝트 열기',exact:true}).click();
    await page.getByLabel('대표 실행 PC',{exact:true}).selectOption(remoteId);
    await page.getByRole('button',{name:/원격 결과 보존/}).click();
    await expect(page.getByText('사용자 확인 전 결과',{exact:true}).first()).toBeVisible();
    await expect(page.getByRole('button',{name:'결과 확인',exact:true})).toBeDisabled();
    await page.getByRole('region',{name:'프로젝트 작업 PC'}).screenshot({path:info.outputPath('project-remote-owner-offline.png')});
    const remoteTree=page.getByRole('list',{name:'원격 프로젝트 세션',exact:true});
    await expect(remoteTree.getByText('원격 저장소',{exact:true})).toBeVisible();
    await expect(remoteTree.getByText('/fixture/project-wt/worker',{exact:true})).toBeVisible();
    await expect(remoteTree.getByRole('button',{name:'Codex 세션 열기',exact:true})).toBeVisible();
    await expect(remoteTree.getByText('원격 저장소 연결 끊김 · 마지막 확인 내용',{exact:true})).toBeVisible();
    expect((await page.evaluate(()=>window.multiCliWork.terminals.list())).find(value=>value.remote?.sessionId===remoteSessionId)?.projectId).toBeNull();
    await remoteTree.screenshot({path:info.outputPath('remote-sidebar-offline.png')});
    expect(await fs.readFile(path.join(registry,"projects.json"),"utf8")).toContain("Herdr 검증");
    expect(await fs.readFile(path.join(registry,'work-projects.json'),'utf8')).not.toContain('hostProjects');
    await expect(fs.access(path.join(recovery,`recover.${process.platform==="win32"?"cmd":"sh"}`))).resolves.toBeUndefined();
    await expect(fs.access(path.join(recovery,'recovery-controller.cjs'))).resolves.toBeUndefined();
    // A host-launched worker has no renderer-supplied worktreeId. Reconciliation
    // must recover ownership before the normal worktree deletion flow can stop it.
    const owned=await page.evaluate(({projectId,fixtureHead})=>window.multiCliWork.worktrees.create(projectId,{kind:'new',branch:'fixture-worker-removal',startPoint:fixtureHead}),{projectId,fixtureHead});
    const fixtureRelative=path.relative(await fs.realpath(directory),await fs.realpath(owned.worktree.path));
    expect(fixtureRelative).not.toBe('');expect(fixtureRelative).not.toMatch(/^\.\.(?:[\\/]|$)/);expect(path.isAbsolute(fixtureRelative)).toBe(false);
    const workerId='owned-worktree-worker';
    await client.createTerminal({sessionId:workerId,kind:windows?'powershell':'bash',cwd:owned.worktree.path,executable:path.join(resourcesDirectory,windows?'node/windows/node.exe':'node/linux/node'),args:['-e','setInterval(()=>{},1000)'],env:{},projectId,createdAt:new Date().toISOString()});
    await expect.poll(()=>page.evaluate(()=>window.multiCliWork.terminals.list())).toEqual(expect.arrayContaining([expect.objectContaining({id:workerId,worktreeId:owned.worktree.id,pid:0})]));
    expect(await page.evaluate(id=>window.multiCliWork.worktrees.remove(id,false),owned.worktree.id)).toEqual({removed:true});
    await expect(fs.stat(owned.worktree.path)).rejects.toMatchObject({code:'ENOENT'});
    await expect.poll(()=>client!.terminals()).toEqual(expect.arrayContaining([expect.objectContaining({id:workerId,status:'exited'})]));
    expect((await git('status','--porcelain')).stdout.trim()).toBe('');expect((await git('rev-parse','HEAD')).stdout.trim()).toBe(fixtureHead);
    const finalGui=app.process();await app.evaluate(({app})=>app.quit());await expect.poll(()=>finalGui.exitCode).not.toBe(null);app=undefined;
    observer?.close();observer=undefined;
    await mobile.close();mobile=undefined;
    for(const terminal of await client.terminals() as {id:string}[])await client.stopTerminal(terminal.id);
    await client.shutdown();client=undefined;
    await exerciseOfflineRecovery(directory);
    succeeded = true;
  } catch (error) {
    if(app)await app.firstWindow().then(async page=>{
      await page.screenshot({path:info.outputPath('v2-failure.png')});
      console.error('v2 geometry:',await page.evaluate(()=>Object.fromEntries(['.terminal-workspace','.workspace-body','.workspace-grid','.herdr-terminal','.herdr-terminal-actions','.file-explorer'].map(selector=>{const element=document.querySelector(selector),rect=element?.getBoundingClientRect();return [selector,rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height,scrollLeft:element!.scrollLeft}:null];}))));
    }).catch(()=>undefined);
    if(app)for(const window of app.windows()) console.error("v2 renderer diagnostic:",await window.evaluate(()=>document.body.innerText).catch(()=>null));
    console.error("v2 scenario failure:",error);
    console.error("v2 Electron main stderr:", errors.join(""));
    console.error("v2 startup fixture entries:", await fs.readdir(userData).catch(()=>[]), await fs.readdir(`${userData}-v2`).catch(()=>[]), await fs.readdir(path.join(directory,"recovery")).catch(()=>[]));
    throw error;
  } finally {
    await mobile?.close();
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

test('a reconnect error keeps terminal controls inside the workspace at desktop widths',async()=>{
  test.skip(process.env.MCW_V2_E2E!=='1','Desktop browser verification for the v2 candidate');
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage(),css=await fs.readFile('src/renderer/src/index.css','utf8')+await fs.readFile('src/renderer/src/herdr/herdr-terminal.css','utf8');
    await page.setContent(`<style>${css}</style><div class="app-shell"><aside style="grid-column:1">Projects</aside><section class="terminal-workspace"><header>Session</header><div class="workspace-body"><div class="workspace-message-area"><div class="action-error"><span>Error invoking remote method 'v2:terminal-command': Error: 호스트 연결이 복구되면 제어권을 다시 요청하세요.</span><button>닫기</button></div></div><div class="workspace-grid" style="grid-template-columns:1fr;grid-template-rows:1fr"><div class="grid-pane"><div>Header</div><section class="herdr-terminal"><div class="herdr-terminal-toolbar"><span>관찰 중</span><span>크기 소유자: 없음</span><div class="herdr-terminal-actions"><button>제어 요청</button><button>복사</button></div></div><div class="herdr-terminal-viewport"><canvas width="1200" height="500"></canvas></div></section></div></div></div></section><aside class="file-explorer"><div>Files</div><div role="tree" class="file-tree">fixture.txt</div></aside></div>`);
    for(const width of [900,1280]){
      await page.setViewportSize({width,height:680});
      await page.getByRole('button',{name:'제어 요청',exact:true}).click();
      const rectangles=await page.evaluate(()=>['.terminal-workspace','.workspace-grid'].map(selector=>document.querySelector(selector)!.getBoundingClientRect().right));
      expect(rectangles[1]).toBeLessThanOrEqual(rectangles[0]+1);
    }
  }finally{await browser.close();}
});

test('packaged startup failure leaves an independent recovery controller before data cloning',async({},info)=>{
  test.skip(process.env.MCW_V2_E2E!=='1'||!process.env.MCW_V2_E2E_EXECUTABLE,'Uses a packaged candidate; never executes an installer');
  test.setTimeout(90000);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mcw-v2-before-copy-'));
  const userData=path.join(directory,'user-data'),registry=path.join(directory,'registry'),recoveryRoot=path.join(directory,'recovery'),claude=path.join(directory,'claude');
  await fs.mkdir(userData);await fs.mkdir(registry);await fs.mkdir(path.join(claude,'plugins'),{recursive:true});
  await fs.writeFile(path.join(userData,'settings.json'),'{"general":{"autoCheckUpdates":true}}');
  // An unverifiable v1 mod registry must stop initialization after the data backup,
  // without requiring a working GUI/host to inspect and cancel independent recovery.
  await fs.writeFile(path.join(claude,'plugins/installed_plugins.json'),'{"plugins":[]}');
  const environment={...process.env,MCW_RUNTIME:'v2-preview',MCW_V1_REGISTRY:registry,MCW_RECOVERY_ROOT:recoveryRoot,MULTI_CLI_WORK_USER_DATA:userData,MULTI_CLI_WORK_CLAUDE_CONFIG_DIR:claude};
  delete (environment as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
  let app:ElectronApplication|undefined,succeeded=false;
  try{
    app=await electron.launch({executablePath:process.env.MCW_V2_E2E_EXECUTABLE!,args:[],env:Object.fromEntries(Object.entries(environment).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))});
    const installationFile=path.join(recoveryRoot,'installation.json');
    await expect.poll(()=>fs.access(installationFile).then(()=>true,()=>false),{timeout:30000}).toBe(true);
    const installation=JSON.parse(await fs.readFile(installationFile,'utf8'));
    await expect(fs.access(path.join(recoveryRoot,`return-to-v1.${process.platform==='win32'?'cmd':'sh'}`))).resolves.toBeUndefined();
    await expect(fs.access(path.join(`${userData}-v2`,'v2-initialized.json'))).rejects.toThrow();
    await expect(fs.access(path.join(installation.hostDirectory,'mcw-host.json'))).rejects.toThrow();
    const child=app.process();await app.evaluate(({app})=>app.quit());await expect.poll(()=>child.exitCode,{timeout:15000}).not.toBe(null);app=undefined;
    const operationId=randomUUID(),operationDirectory=path.join(recoveryRoot,'operations',operationId);await fs.mkdir(operationDirectory,{recursive:true});
    const request={...installation,operationId,operationDirectory,destination:path.join(operationDirectory,'prepared'),expectedHostIds:[installation.localHostId],guiProcess:null};
    const requestFile=path.join(operationDirectory,'request.json');await fs.writeFile(requestFile,JSON.stringify(request));
    const runtime=path.join(installation.assetsDirectory,process.platform==='win32'?'recovery-node.exe':'recovery-node');
    const script=`(async()=>{const request=JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8'));const {createAdapter}=require(process.argv[2]);const adapter=await createAdapter(request);try{await adapter.stopNewWork();const observations=await adapter.observeHosts();await adapter.cancel();process.stdout.write(JSON.stringify({observations,phase:adapter.state().phase}));}finally{await adapter.close();}})().catch(error=>{console.error(error);process.exitCode=1;});`;
    // No gracefulStop, installer, data activation or v1 launch is invoked here.
    const result=await promisify(execFile)(runtime,['-e',script,requestFile,path.join(installation.assetsDirectory,'recovery-controller.cjs')],{env:environment,windowsHide:true,timeout:30000,maxBuffer:65536});
    expect(JSON.parse(result.stdout)).toMatchObject({phase:'cancelled',observations:[{hostId:installation.localHostId,state:'completed'}]});
    expect(await fs.readFile(path.join(userData,'settings.json'),'utf8')).toBe('{"general":{"autoCheckUpdates":true}}');
    expect(await fs.readFile(path.join(claude,'plugins/installed_plugins.json'),'utf8')).toBe('{"plugins":[]}');
    await info.attach('independent-startup-recovery',{body:result.stdout,contentType:'application/json'});succeeded=true;
  }finally{
    if(app){const child=app.process();await app.evaluate(({app})=>app.quit()).catch(()=>undefined);await expect.poll(()=>child.exitCode,{timeout:15000}).not.toBe(null);}
    if(succeeded)await fs.rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});else await info.attach('startup-failure-fixture',{body:directory,contentType:'text/plain'});
  }
});
