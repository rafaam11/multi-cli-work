import {_electron as electron,expect,test,type ElectronApplication} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {HostClient,type HostTerminalSocket} from '../src/main/host/host-client';
import {HerdrApiClient} from '../src/main/herdr/api-client';
import {resolveHerdrPaths} from '../src/main/herdr/runtime';
import {applySurfaceEvent,selectionText} from '../src/shared/herdr-surface-model';
import type {PaneSurfaceFrame,HerdrSurfaceEvent} from '../src/shared/herdr-surface-types';

// Real Chromium composition, clipboard and pointer events -> Canvas -> host ->
// native Herdr -> a disposable raw-mode native program. This is not a physical OS
// IME or Android device test. No user repository, shell profile or installer runs.
test('desktop terminal accepts Korean composition, paste, mouse, graphics and scrollback',async({},info)=>{
  test.skip(process.env.MCW_V2_E2E!=='1','Requires build:v2 resources');
  test.setTimeout(120000);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'mcw-terminal-desktop-'));
  const userData=path.join(directory,'user-data'),registry=path.join(directory,'registry'),recoveryRoot=path.join(directory,'recovery');
  await fs.mkdir(userData);await fs.mkdir(registry);
  const probe=path.resolve('native/herdr-bridge/target/debug/examples',process.platform==='win32'?'terminal-probe.exe':'terminal-probe');
  await fs.access(probe);
  const env:NodeJS.ProcessEnv={...process.env,MCW_RUNTIME:process.env.MCW_V2_E2E_RUNTIME??'v2-preview',MCW_V1_REGISTRY:registry,MCW_RECOVERY_ROOT:recoveryRoot,MULTI_CLI_WORK_USER_DATA:userData,MULTI_CLI_WORK_CLAUDE_CONFIG_DIR:path.join(directory,'claude'),MULTI_CLI_WORK_CODEX_SESSIONS_DIR:path.join(directory,'codex')};
  delete env.ELECTRON_RUN_AS_NODE;
  let app:ElectronApplication|undefined,client:HostClient|undefined,observer:HostTerminalSocket|undefined,surface:PaneSurfaceFrame|null=null,succeeded=false;
  const errors:string[]=[];
  // Native cells include wide-glyph continuation slots. Read their displayed
  // text rather than concatenating padding cells into Korean words.
  const surfaceText=()=>surface?selectionText(surface,{x:0,y:0},{x:surface.frame.width-1,y:surface.frame.height-1}):'';
  const readInput=async()=>{const raw=await fs.readFile(path.join(directory,'input.jsonl'),'utf8').catch(()=> '');return Buffer.from(raw.trim().split('\n').filter(Boolean).flatMap(line=>JSON.parse(line) as number[])).toString('utf8');};
  let sequence=0;
  const emit=async(content:string)=>{const id=++sequence;await fs.writeFile(path.join(directory,'emit.json'),JSON.stringify({id,content}));await expect.poll(()=>fs.readFile(path.join(directory,'emitted'),'utf8').catch(()=>'' )).toBe(String(id));};
  try{
    const executablePath=process.env.MCW_V2_E2E_EXECUTABLE;
    app=await electron.launch({...(executablePath?{executablePath,args:[]}:{args:[path.resolve('out/main/index.js')]}),env:Object.fromEntries(Object.entries(env).filter((entry):entry is [string,string]=>typeof entry[1]==='string'))});
    app.process().stderr?.on('data',data=>errors.push(String(data)));
    const page=await app.firstWindow();page.on('pageerror',error=>errors.push(String(error)));
    await expect.poll(()=>page.evaluate(()=>window.mcwV2?.version)).toBe(2);
    const descriptor=JSON.parse(await fs.readFile(path.join(`${userData}-v2`,'host/mcw-host.json'),'utf8'));client=new HostClient(descriptor);
    const sessionId='desktop-input';
    await client.createTerminal({sessionId,kind:process.platform==='win32'?'powershell':'bash',cwd:directory,executable:probe,args:[directory],env:{},projectId:null,createdAt:new Date().toISOString()});
    observer=client.terminalSocket(sessionId,event=>{const outer=event as {snapshot?:HerdrSurfaceEvent;frame?:HerdrSurfaceEvent};const value=outer.snapshot??outer.frame;if(value&&['surface','patch'].includes(value.type))surface=applySurfaceEvent(surface,value).surface;});
    await expect.poll(()=>fs.access(path.join(directory,'ready')).then(()=>true,()=>false)).toBe(true);
    await page.getByRole('region',{name:'세션 패널',exact:true}).getByRole('button',{name:/패인 열기/}).first().click();
    const pane=page.locator(`[data-session-id="${sessionId}"]`),input=pane.getByLabel('터미널 입력',{exact:true}),canvas=pane.getByRole('img',{name:'터미널 화면'});
    await expect(canvas).toBeVisible();await pane.getByRole('button',{name:'제어 요청',exact:true}).click();
    await expect(input).toHaveAttribute('aria-readonly','false');
    // A missing Korean face renders distinct syllables as the same tofu box.
    // Check the packaged face loaded and rasterize through the real input's
    // preferred-font stack so this detects missing Linux fonts without network.
    const glyphs=await input.evaluate(async element=>{
      const faces=await document.fonts.load('32px "MCW Noto Sans KR"','한글');
      const family=getComputedStyle(element).fontFamily;
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
      const context=canvas.getContext('2d')!;context.font=`32px ${family}`;context.textBaseline='top';context.fillStyle='#fff';
      const raster=(text:string)=>{context.clearRect(0,0,64,64);context.fillText(text,0,0);return Array.from(context.getImageData(0,0,64,64).data).filter((_,index)=>index%4===3);};
      const a=raster('한'),b=raster('글');
      // The fallback must not replace Latin with its proportional glyphs when
      // the user's preferred monospace faces are unavailable on Linux.
      context.font='32px "MCW nonexistent test font", "MCW Noto Sans KR", monospace';
      const asciiI=context.measureText('iiiiiiii').width,asciiW=context.measureText('WWWWWWWW').width;
      return {loaded:faces.some(face=>face.status==='loaded'),family,inkA:a.filter(value=>value>0).length,inkB:b.filter(value=>value>0).length,difference:a.reduce((sum,value,index)=>sum+(value!==b[index]?1:0),0),asciiI,asciiW};
    });
    expect(glyphs.loaded).toBe(true);expect(glyphs.family).toContain('MCW Noto Sans KR');
    expect(glyphs.inkA).toBeGreaterThan(30);expect(glyphs.inkB).toBeGreaterThan(30);expect(glyphs.difference).toBeGreaterThan(50);
    expect(Math.abs(glyphs.asciiI-glyphs.asciiW)).toBeLessThan(0.01);
    await expect.poll(()=>surface?.frame.cells.map(cell=>cell.symbol).join('')).toContain('READY>');
    await fs.writeFile(info.outputPath('initial-surface.json'),JSON.stringify(surface!.frame));
    await info.attach('initial-surface',{path:info.outputPath('initial-surface.json'),contentType:'application/json'});
    await input.focus();
    const cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition',{text:'한글',selectionStart:2,selectionEnd:2});
    await expect(input).toHaveValue('한글');
    expect(await input.evaluate(element=>getComputedStyle(element).opacity)).toBe('1');
    const cursor=surface!.frame.cursor!,box=await canvas.boundingBox(),inputBox=await input.boundingBox();
    expect(inputBox!.y).toBeGreaterThanOrEqual(box!.y+cursor.y*10);
    await pane.screenshot({path:info.outputPath('korean-composition.png')});
    const beforeIme=await readInput();
    await cdp.send('Input.insertText',{text:'한글'});
    await expect.poll(readInput).toContain('한글');
    expect((await readInput()).slice(beforeIme.length)).toBe('한글');
    await expect(input).toHaveValue('');
    const pasted='붙여넣기\n두 번째 줄';
    await app.evaluate(({clipboard},text)=>clipboard.writeText(text),pasted);
    await input.press('Control+V');
    await expect.poll(readInput).toContain('붙여넣기');
    expect((await readInput()).split('붙여넣기')).toHaveLength(2);
    expect(await readInput()).toContain('\x1b[200~');
    await emit('\x1b[2J\x1b[HSELECT 한글 COPY\r\n'+'ROW\r\n'.repeat(100)+'BOTTOM\r\n');
    await expect.poll(()=>surface?.panes[0]?.scroll?.max_offset_from_bottom??0).toBeGreaterThan(50);
    const scroller=pane.getByLabel('터미널 스크롤',{exact:true});
    await scroller.fill('0');
    await expect.poll(()=>surface?.panes[0]?.scroll?.offset_from_bottom??0).toBeGreaterThan(50);
    await pane.getByRole('button',{name:'맨 아래',exact:true}).click();
    await expect.poll(()=>surface?.panes[0]?.scroll?.offset_from_bottom).toBe(0);
    await page.getByRole('menuitem',{name:'편집',exact:true}).click();
    await page.getByRole('menuitem',{name:/^모두 선택/}).click();
    await page.getByRole('menuitem',{name:'편집',exact:true}).click();
    await page.getByRole('menuitem',{name:/^복사/}).click();
    await expect.poll(()=>app!.evaluate(({clipboard})=>clipboard.readText())).toContain('SELECT 한글 COPY');
    expect(await app.evaluate(({clipboard})=>clipboard.readText())).toContain('BOTTOM');
    await input.press('Control+f');
    const search=pane.getByRole('search',{name:'터미널에서 찾기',exact:true});
    await search.getByLabel('찾을 텍스트',{exact:true}).fill('SELECT 한글 COPY');
    await search.getByLabel('찾을 텍스트',{exact:true}).press('Enter');
    await expect(search.getByText(/개 결과$/)).toBeVisible();
    await expect.poll(surfaceText).toContain('SELECT 한글 COPY');
    await pane.getByRole('button',{name:'복사',exact:true}).click();
    await expect.poll(()=>app!.evaluate(({clipboard})=>clipboard.readText())).toContain('SELECT 한글 COPY');
    const searchBox=(await search.boundingBox())!,paneBox=(await pane.boundingBox())!;
    expect(searchBox.y).toBeGreaterThanOrEqual(paneBox.y);expect(searchBox.x).toBeGreaterThanOrEqual(paneBox.x);
    expect(searchBox.x+searchBox.width).toBeLessThanOrEqual(paneBox.x+paneBox.width+1);
    // An opaque theme selection must not paint over the matched glyphs.
    await expect.poll(()=>canvas.evaluate(element=>{const c=element as HTMLCanvasElement,scale=c.width/c.getBoundingClientRect().width;const pixels=c.getContext('2d')!.getImageData(0,0,Math.ceil(130*scale),Math.ceil(19*scale)).data;let light=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>150&&pixels[i+1]>150&&pixels[i+2]>150)light++;return light;})).toBeGreaterThan(30);
    await pane.screenshot({path:info.outputPath('scrollback-search.png')});
    await search.getByRole('button',{name:'닫기',exact:true}).click();
    await pane.getByRole('button',{name:'맨 아래',exact:true}).click();
    await expect.poll(()=>surface?.panes[0]?.scroll?.offset_from_bottom).toBe(0);
    await page.getByRole('menuitem',{name:'세션',exact:true}).click();
    await page.getByRole('menuitem',{name:/^새로고침/}).click();
    await expect(input).toHaveAttribute('aria-readonly','false');
    await page.getByRole('menuitem',{name:'세션',exact:true}).click();
    await expect(page.getByRole('menuitem',{name:/^새로고침/})).toBeEnabled();
    await page.keyboard.press('Escape');
    await emit('\x1b[2J\x1b[HSELECT 한글 COPY\r\n');
    await expect.poll(surfaceText).toContain('SELECT 한글 COPY');
    const selectionBox=(await canvas.boundingBox())!,cw=selectionBox.width/surface!.frame.width,ch=selectionBox.height/surface!.frame.height;
    await page.mouse.move(selectionBox.x+cw*.3,selectionBox.y+ch*.5);await page.mouse.down();await page.mouse.move(selectionBox.x+cw*15.8,selectionBox.y+ch*.5,{steps:4});await page.mouse.up();
    await pane.getByRole('button',{name:'복사',exact:true}).click();
    await expect.poll(()=>app!.evaluate(({clipboard})=>clipboard.readText())).toContain('SELECT 한글 COPY');
    await emit('\x1b[?1000h\x1b[?1006h');
    await expect.poll(()=>surface?.panes[0]?.mouse_reporting).toBe(true);
    const beforeMouse=await readInput();await canvas.click({position:{x:cw*3.5,y:ch*2.5}});
    await expect.poll(async()=>(await readInput()).slice(beforeMouse.length)).toContain('\x1b[<0;4;3M');
    expect((await readInput()).slice(beforeMouse.length)).toContain('\x1b[<0;4;3m');
    const red=Buffer.from(Array.from({length:12},(_,i)=>i%3===0?255:0)).toString('base64');
    await input.press('Escape');
    await emit(`\x1b[?1000l\x1b[?1006l\x1b[2J\x1b[H\x1b_Ga=T,f=24,s=2,v=2,c=4,r=2,q=2;${red}\x1b\\`);
    await expect.poll(()=>surface?.graphics.placements.length??0).toBeGreaterThan(0);
    await expect.poll(()=>canvas.evaluate(element=>{const c=element as HTMLCanvasElement;const pixels=c.getContext('2d')!.getImageData(0,0,c.width,c.height).data;let red=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]>240&&pixels[i+1]<10&&pixels[i+2]<10)red++;return red;})).toBeGreaterThan(100);
    await pane.screenshot({path:info.outputPath('kitty-graphics.png')});
    await emit('\x1b[2J\x1b[HMCW_CLEAR_SCREEN\r\n');
    await expect.poll(()=>surface?.frame.cells.map(cell=>cell.symbol).join('')).toContain('MCW_CLEAR_SCREEN');
    await page.getByRole('menuitem',{name:'편집',exact:true}).click();
    await page.getByRole('menuitem',{name:'터미널 지우기',exact:true}).click();
    await expect.poll(()=>surface?.frame.cells.map(cell=>cell.symbol).join('')).not.toContain('MCW_CLEAR_SCREEN');
    const loadStarted=Date.now(),extraDirectories:string[]=[];
    const questionTask=await client.createTask({title:'숨긴 세션 질문 검증',brief:'Disposable UI observation only; no provider launch.',lead:{provider:'codex',profileId:'fixture',hostId:descriptor.hostId},workers:[]});
    const participant=questionTask.participants[0];
    const {token}=await client.issueTaskToken({taskId:questionTask.id,participantId:participant.id,attemptId:participant.attempt.id,generation:participant.attempt.generation});
    const scoped=new HostClient({...descriptor,token});
    for(let index=1;index<15;index++){
      const extra=path.join(directory,`session-${index}`);extraDirectories.push(extra);await fs.mkdir(extra);
      await client.createTerminal({sessionId:index===14?participant.attempt.id:`desktop-load-${index}`,kind:process.platform==='win32'?'powershell':'bash',cwd:extra,executable:probe,args:[extra],env:{},projectId:null,createdAt:new Date().toISOString()});
    }
    await expect.poll(async()=>(await client!.terminals()).length).toBe(15);
    await expect(page.getByRole('button',{name:'세션 작업공간 열기 (패인 15개)',exact:true})).toBeVisible();
    const summaries=await client.terminals() as {id:string;paneId:string;tabId:string;connected:boolean}[];
    expect(new Set(summaries.map(value=>value.paneId)).size).toBe(15);expect(new Set(summaries.map(value=>value.tabId)).size).toBe(15);
    const creationMs=Date.now()-loadStarted;
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
    await Promise.all(extraDirectories.map(extra=>fs.writeFile(path.join(extra,'emit.json'),JSON.stringify({id:1,content:'HIDDEN HOST OUTPUT\r\n'.repeat(40)}))));
    await expect.poll(async()=>Promise.all(extraDirectories.map(extra=>fs.readFile(path.join(extra,'emitted'),'utf8').catch(()=>'')))).toEqual(Array.from({length:14},()=> '1'));
    const asked=await scoped.request<{result:{isError:boolean}}>('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'task_message',arguments:{kind:'question',text:'숨긴 세션의 질문을 확인하세요.'}}});
    expect(asked.result.isError).toBe(false);
    expect((await client.inspectTask(questionTask.id)).questions[0].acknowledged).toBe(false);
    const restoredAt=Date.now();await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.show();window.focus();});
    const panel=page.getByRole('region',{name:'세션 패널'});
    await expect(panel.getByText('대기 1',{exact:true})).toBeVisible();
    await panel.getByRole('button',{name:'대기',exact:true}).click();
    await expect(panel.locator('.session-row')).toHaveCount(1);
    await panel.getByRole('button',{name:/작업공간에서 숨기기$/}).click();
    await expect(panel.locator('.session-row')).toHaveCount(1);
    expect((await client.inspectTask(questionTask.id)).questions[0].acknowledged).toBe(false);
    await panel.getByRole('button',{name:'전체',exact:true}).click();await expect(panel.locator('.session-row')).toHaveCount(15);
    const restoreMs=Date.now()-restoredAt;
    expect((await client.terminals() as {connected:boolean}[]).every(value=>value.connected)).toBe(true);
    await page.screenshot({path:info.outputPath('fifteen-sessions-hidden-question.png')});
    for(let index=0;index<6;index++)await panel.locator('.session-row .file-tab-open').nth(index).click();
    await page.getByRole('radio',{name:'6열',exact:true}).click();
    await expect(page.getByTestId('herdr-terminal')).toHaveCount(6);
    await expect(page.getByRole('img',{name:'터미널 화면'})).toHaveCount(6);
    await page.screenshot({path:info.outputPath('six-visible-of-fifteen.png')});
    await client.request(`/tasks/${questionTask.id}/cancel`,'POST',{});
    const observations={platform:process.platform,ime:'Chromium CDP composition and commit, not physical OS IME',paste:true,selection:true,selectAllScrollback:true,clear:true,scrollback:true,search:true,refreshCompletion:true,mouse:'SGR press and release',graphics:'Kitty RGB pixels rendered',sessions:15,concurrentVisible:6,creationMs,restoreMs,hiddenOutputSessions:14,hiddenQuestionUnread:true};
    await fs.writeFile(info.outputPath('terminal-observations.json'),JSON.stringify(observations,null,2));
    await info.attach('terminal-observations',{path:info.outputPath('terminal-observations.json'),contentType:'application/json'});
    succeeded=true;
  }catch(error){if(app)await app.firstWindow().then(page=>page.screenshot({path:info.outputPath('terminal-failure.png')})).catch(()=>{});throw error;}
  finally{
    observer?.close();
    if(app){const child=app.process();await app.evaluate(({app})=>app.quit()).catch(()=>{});await expect.poll(()=>child.exitCode,{timeout:15000}).not.toBe(null);}
    if(client){for(const terminal of await client.terminals() as {id:string}[])await client.stopTerminal(terminal.id);await client.shutdown();}
    await new HerdrApiClient(resolveHerdrPaths(path.join(`${userData}-v2`,'host/herdr')).endpoint).request('server.stop',{}).catch(()=>{});
    await info.attach('main-stderr',{body:errors.join(''),contentType:'text/plain'});
    if(succeeded)await fs.rm(directory,{recursive:true,force:true,maxRetries:15,retryDelay:100});else await info.attach('fixture',{body:directory,contentType:'text/plain'});
  }
});
