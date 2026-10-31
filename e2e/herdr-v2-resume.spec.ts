import {_electron as electron,expect,test,type ElectronApplication} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {HostClient} from '../src/main/host/host-client';
import {HerdrApiClient} from '../src/main/herdr/api-client';
import {resolveHerdrPaths} from '../src/main/herdr/runtime';
import {applySurfaceEvent} from '../src/shared/herdr-surface-model';
import type {PaneSurfaceFrame,HerdrSurfaceEvent} from '../src/shared/herdr-surface-types';
import {legacySuccessorId} from '../src/main/v2/worker-gateway';

for(const legacy of [false,true])test(`desktop terminal click, failed launch recovery and explicit resume use real Herdr${legacy?' with the existing v2.0.1 host':''}`,async({},info)=>{
  test.skip(process.env.MCW_V2_E2E!=='1','Requires verified packaged Herdr resources');
  test.skip(legacy&&!process.env.MCW_V2_E2E_LEGACY_EXECUTABLE,'Requires the original v2.0.1 application');
  test.setTimeout(120000);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mcw-v2-resume-'));
  const registry=path.join(directory,'registry'),userData=path.join(directory,'user-data'),repo=path.join(directory,'project');
  await Promise.all([registry,userData,repo].map(p=>fs.mkdir(p)));
  const projectId='11111111-1111-4111-8111-111111111111',now=new Date().toISOString();
  await fs.writeFile(path.join(registry,'projects.json'),JSON.stringify({schemaVersion:1,updatedAt:now,projects:{[projectId]:{id:projectId,rootPath:repo,displayName:'재개 검증',sources:['manual'],providerRefs:{claude:[],codex:[]},status:null,memo:'',tracks:[],hidden:false,order:0,createdAt:now,updatedAt:now}}}));
  const environment={...process.env,MCW_RUNTIME:process.env.MCW_V2_E2E_RUNTIME??'v2-preview',MCW_V1_REGISTRY:registry,MCW_RECOVERY_ROOT:path.join(directory,'recovery'),MULTI_CLI_WORK_USER_DATA:userData,MULTI_CLI_WORK_REMOTE_BIND:'127.0.0.1',MULTI_CLI_WORK_CLAUDE_CONFIG_DIR:path.join(directory,'claude'),MULTI_CLI_WORK_CODEX_SESSIONS_DIR:path.join(directory,'codex')};
  delete environment.ELECTRON_RUN_AS_NODE;
  let app:ElectronApplication|undefined,client:HostClient|undefined,succeeded=false,observer:ReturnType<HostClient['terminalSocket']>|undefined;
  try{
    let legacyInstance:string|undefined;
    if(legacy){
      app=await electron.launch({executablePath:process.env.MCW_V2_E2E_LEGACY_EXECUTABLE,args:[],env:Object.fromEntries(Object.entries(environment).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))});
      const oldPage=await app.firstWindow();await expect.poll(()=>oldPage.evaluate(()=>window.mcwV2?.version)).toBe(2);
      client=new HostClient(JSON.parse(await fs.readFile(path.join(`${userData}-v2`,'host/mcw-host.json'),'utf8')));
      legacyInstance=(await client.health()).instanceId;
      expect((await client.health()).capabilities?.terminalRestart).toBeUndefined();
      await app.evaluate(({app})=>app.quit());await expect.poll(()=>app!.process().exitCode).not.toBeNull();app=undefined;
    }
    const executablePath=process.env.MCW_V2_E2E_EXECUTABLE;
    app=await electron.launch({...(executablePath?{executablePath,args:[]}:{args:[path.resolve('out/main/index.js')]}),env:Object.fromEntries(Object.entries(environment).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))});
    const page=await app.firstWindow();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    await expect.poll(()=>page.evaluate(()=>window.mcwV2?.version)).toBe(2);
    client=new HostClient(JSON.parse(await fs.readFile(path.join(`${userData}-v2`,'host/mcw-host.json'),'utf8')));
    const kind=process.platform==='win32'?'powershell':'bash';
    const session=await page.evaluate(({projectId,kind})=>window.multiCliWork.terminals.create({projectId,kind,cols:80,rows:24}),{projectId,kind});
    let surface:PaneSurfaceFrame|null=null;
    observer=client.terminalSocket(session.id,event=>{
      const outer=event as {type?:string;snapshot?:HerdrSurfaceEvent;frame?:HerdrSurfaceEvent};
      const value=outer.snapshot??outer.frame;
      if(outer.type==='disconnected'||value?.type==='disconnected'){surface=null;return;}
      if(value&&['surface','patch'].includes(value.type))surface=applySurfaceEvent(surface,value).surface;
    });
    await page.locator('.session-row').first().getByRole('button',{name:/패인 열기/}).click();
    let terminal=page.locator(`[data-session-id="${session.id}"].herdr-terminal`);
    await expect(terminal.getByRole('button',{name:'제어 요청',exact:true})).toBeEnabled();
    await expect(terminal.getByLabel('터미널 입력',{exact:true})).toHaveAttribute('aria-readonly','true');
    await terminal.getByRole('img',{name:'터미널 화면'}).click({position:{x:15,y:15}});
    await expect(terminal.getByLabel('터미널 입력',{exact:true})).toHaveAttribute('aria-readonly','false');
    await expect(terminal.getByLabel('터미널 입력',{exact:true})).toBeFocused();
    await page.keyboard.type('echo MCW_CLICK_INPUT_OK');await page.keyboard.press('Enter');
    await expect.poll(()=>surface?.frame.cells.map(cell=>cell.symbol).join('')).toContain('MCW_CLICK_INPUT_OK');
    const hostSession=(await client.terminals() as any[]).find(s=>s.id===session.id);
    // Exiting inside the shell keeps the same renderer/observer subscribed.
    await page.keyboard.type('exit');await page.keyboard.press('Enter');
    await expect.poll(async()=>(await client!.terminals() as any[]).find(s=>s.id===session.id)?.status).toBe('exited');
    const returned={id:legacy?legacySuccessorId(session.id,hostSession.generation):session.id};
    await page.getByRole('button',{name:'세션 재개',exact:true}).click();
    await expect.poll(async()=>(await client!.terminals() as any[]).find(s=>s.id===returned.id)?.delivery).toBe('delivered');
    await expect.poll(async()=>(await client!.terminals() as any[]).find(s=>s.id===returned.id)?.generation).not.toBe(hostSession.generation);
    const resumed=(await client.terminals() as any[]).find(s=>s.id===returned.id);
    if(legacy){
      expect(returned.id).not.toBe(session.id);
      expect((await client.terminals() as any[]).find(s=>s.id===session.id).generation).toBe(hostSession.generation);
      expect((await client.health()).instanceId).toBe(legacyInstance);
      const again=await page.evaluate(id=>window.multiCliWork.terminals.resume({sessionId:id,cols:80,rows:24}),session.id);
      expect(again.id).toBe(returned.id);expect(await client.terminals()).toHaveLength(2);
      observer.close();surface=null;
      observer=client.terminalSocket(returned.id,event=>{const outer=event as {snapshot?:HerdrSurfaceEvent;frame?:HerdrSurfaceEvent};const value=outer.snapshot??outer.frame;if(value&&['surface','patch'].includes(value.type))surface=applySurfaceEvent(surface,value).surface;});
      terminal=page.locator(`[data-session-id="${returned.id}"].herdr-terminal`);
      await expect(terminal).toBeVisible();
    }
    expect(resumed.generation).not.toBe(hostSession.generation);expect(resumed.paneId).not.toBe(hostSession.paneId);
    await expect(terminal.getByRole('button',{name:'제어 요청',exact:true})).toBeEnabled();
    await terminal.getByRole('img',{name:'터미널 화면'}).click({position:{x:15,y:15}});
    await expect(terminal.getByLabel('터미널 입력',{exact:true})).toHaveAttribute('aria-readonly','false');
    await page.keyboard.type('echo MCW_RESUMED_INPUT_OK');await page.keyboard.press('Enter');
    await expect.poll(()=>surface?.frame.cells.map(cell=>cell.symbol).join('')).toContain('MCW_RESUMED_INPUT_OK');
    // A failed executable leaves an admitted ID but no running provider. The UI
    // must expose error/resume, and that explicit retry must create only one pane.
    const failedId='failed-shell';
    const failure=await page.evaluate(async input=>{try{await window.mcwV2!.createTerminal(input);return false;}catch{return true;}},{sessionId:failedId,kind,cwd:repo,projectId,createdAt:now,generation:'failed-generation',executable:path.join(directory,'missing-program'),args:[],env:{}});
    expect(failure).toBe(true);
    await expect.poll(()=>page.evaluate(id=>window.multiCliWork.terminals.list().then(s=>s.find(s=>s.id===id)?.status),failedId)).toBe('error');
    const retried=await page.evaluate(id=>window.multiCliWork.terminals.resume({sessionId:id,cols:80,rows:24}),failedId);
    expect((await client.terminals() as any[]).filter(s=>s.id===failedId)).toHaveLength(1);
    expect((await client.terminals() as any[]).find(s=>s.id===retried.id).delivery).toBe('delivered');
    if(!legacy)expect(await fs.readdir(path.join(`${userData}-v2`,'host/terminal-attempts'))).toHaveLength(2);
    await page.screenshot({path:info.outputPath('resumed-terminal.png')});
    expect(errors).toEqual([]);succeeded=true;
  }finally{
    observer?.close();
    if(app){if(!succeeded)await app.firstWindow().then(page=>page.screenshot({path:info.outputPath('failure.png')})).catch(()=>{});await app.evaluate(({app})=>app.quit()).catch(()=>{});}
    if(client){for(const session of await client.terminals() as any[])await client.stopTerminal(session.id).catch(()=>{});await client.shutdown().catch(()=>{});}
    await new HerdrApiClient(resolveHerdrPaths(path.join(`${userData}-v2`,'host/herdr')).endpoint).request('server.stop',{}).catch(()=>{});
    if(succeeded)await fs.rm(directory,{recursive:true,force:true,maxRetries:15,retryDelay:100});
    else await info.attach('fixture',{body:directory,contentType:'text/plain'});
  }
});
