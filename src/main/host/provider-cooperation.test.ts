// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import {createHerdrTerminalService} from "../herdr/terminal-service";
import {TaskStore} from "./task-store";
import {TaskExecutor} from "./task-executor";
import {HostGateway} from "./gateway";
import {HostClient} from "./host-client";
import {detectProviderExecutables} from "../providers/provider-launch";
import {BUILTIN_AGENTS} from "../agents/builtin-agents";
import {TaskMcpServer} from "../mcw-task-mcp";
const exec=promisify(execFile);

// Explicit opt-in: uses the machine's existing CLI authentication/default model choices.
// Never runs in ordinary CI. Only this test-created repository receives a transient
// Codex trust override; Claude trust is confined to disposable CLI config copies.
it.skipIf(process.env.MCW_PROVIDER_PROBE!=="1")("real Claude/Codex workers exchange messages and submit separate unintegrated results",async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"mcw-provider-probe-")),repo=path.join(root,"repository"),directory=path.join(root,"host");
  console.log(`Provider probe evidence: ${root}`);
  await fs.mkdir(repo);await fs.mkdir(directory);
  const git=(...args:string[])=>exec("git",["-C",repo,...args],{windowsHide:true,timeout:10000});
  await git("init");await fs.writeFile(path.join(repo,"README.md"),"MCW isolated provider verification. No product code.\n");await git("add","README.md");await git("-c","user.name=MCW verification","-c","user.email=verify@example.invalid","commit","-m","fixture");
  const head=(await git("rev-parse","HEAD")).stdout.trim();
  const privateFiles:string[]=[],issuedTokens:string[]=[];
  const claudeConfig=async(input:Record<string,unknown>)=>{
    const source=process.env.CLAUDE_CONFIG_DIR??path.join(os.homedir(),".claude");
    const config=path.join(root,"claude",String(input.sessionId));await fs.mkdir(config,{recursive:true,mode:0o700});
    const original=JSON.parse(await fs.readFile(process.env.CLAUDE_CONFIG_DIR?path.join(source,".claude.json"):path.join(os.homedir(),".claude.json"),"utf8"));
    const projects=Object.fromEntries([repo,String(input.cwd)].flatMap(p=>[p,p.replaceAll("\\","/"),p.toLowerCase()]).map(p=>[p,{hasTrustDialogAccepted:true,hasClaudeMdExternalIncludesApproved:false}]));
    await fs.writeFile(path.join(config,".claude.json"),JSON.stringify({hasCompletedOnboarding:true,lastOnboardingVersion:original.lastOnboardingVersion,oauthAccount:original.oauthAccount,projects}),{mode:0o600});
    const settings=JSON.parse(await fs.readFile(path.join(source,"settings.json"),"utf8"));
    const settingsPath=path.join(config,"settings.json");privateFiles.push(settingsPath);await fs.writeFile(settingsPath,JSON.stringify({model:settings.model,effortLevel:settings.effortLevel,env:settings.env}),{mode:0o600});
    const credential=path.join(config,".credentials.json");privateFiles.push(credential);await fs.copyFile(path.join(source,".credentials.json"),credential);await fs.chmod(credential,0o600);
    return config;
  };
  const resources=path.resolve("build/v2"),windows=process.platform==="win32";
  const binaryPath=path.join(resources,windows?"herdr/windows/herdr.exe":"herdr/herdr-linux-x86_64");
  const bridgePath=path.resolve(`build/herdr-bridge/${process.platform}-${process.arch}/${windows?"mcw-herdr-bridge.exe":"mcw-herdr-bridge"}`);
  const executables=await detectProviderExecutables([BUILTIN_AGENTS.claude,BUILTIN_AGENTS.codex]);
  if(!executables.agents.claude||!executables.agents.codex)throw new Error("Both installed providers are required");
  const terminals=await createHerdrTerminalService({root:directory,binaryPath,binarySha256:createHash("sha256").update(await fs.readFile(binaryPath)).digest("hex"),bridgePath,modsDirectory:path.join(resources,"mods")});
  const store=new TaskStore({directory,hostId:"provider-probe"});let executor:TaskExecutor;
  const gateway=new HostGateway({directory,store,terminals,startTask:async(id,input)=>{
    try{return await executor.start(id,input);}catch(error){let message=String(error);for(const token of issuedTokens)message=message.replaceAll(token,"[task capability redacted]");await fs.writeFile(path.join(root,"launch-error.txt"),message,{mode:0o600});throw error;}
  }});
  let client:HostClient|undefined,taskId:string|undefined;
  const handle=TaskMcpServer.prototype.handle;
  const requests=vi.spyOn(TaskMcpServer.prototype,"handle").mockImplementation(async function(this:TaskMcpServer,input){
    const request=input as {method?:string;params?:{name?:string;_meta?:Record<string,unknown>}};
    await fs.appendFile(path.join(root,"mcp-request-shapes.jsonl"),JSON.stringify({method:request.method,tool:request.params?.name,params:Object.keys(request.params??{}),metadata:Object.keys(request.params?._meta??{})})+"\n",{mode:0o600});
    return handle.call(this,input);
  });
  try {
    await gateway.start();client=new HostClient(gateway.descriptor);
    const fixtureTerminals={...terminals,create:async(input:Record<string,unknown>)=>{
      const args=(input.args as string[]).filter(arg=>!["--dangerously-skip-permissions","--dangerously-bypass-approvals-and-sandbox"].includes(arg));
      if(input.kind==="codex"){
        // The CLI dotted-key parser does not parse quoted path segments; pass
        // one inline TOML table instead. This override lasts only this process.
        const paths=Array.from(new Set([repo,repo.toLowerCase(),String(input.cwd),String(input.cwd).toLowerCase()]));
        const trust=`projects={${paths.map(p=>`${JSON.stringify(p)}={trust_level="trusted"}`).join(",")}}`;
        return terminals.create({...input,args:["--sandbox","read-only","--ask-for-approval","never",...args,"-c",trust]});
      }
      return terminals.create({...input,args:["--allowedTools","Read,mcp__mcw_task__*","--permission-mode","default",...args],env:{...(input.env as Record<string,string>),CLAUDE_CONFIG_DIR:await claudeConfig(input)}});
    }};
    executor=new TaskExecutor({directory,store,terminals:fixtureTerminals,issueTaskToken:async ref=>{const token=await gateway.issueTaskToken(ref);issuedTokens.push(token);return token;},gatewayUrl:()=>gateway.descriptor.url,mcpClientPath:path.join(resources,"host/mcw-task-mcp-client.js"),mcpExecutable:path.join(resources,windows?"node/windows/node.exe":"node/linux/node")});
    const brief=`This is a small read-only MCW integration verification. Do not edit files, run unrelated tools, change global settings, spawn agents, merge or push. Use mcw_task tools. First task_inspect, find your participant ID from MCW_PARTICIPANT_ID if needed, and broadcast a message with text READY. The lead waits for READY from both workers and broadcasts GO. Each worker waits for GO, then sends a targeted message PEER_HELLO to the other worker's participant ID. Each worker must receive PEER_HELLO from the other worker before task_submit. Submit summary MCW_PROVIDER_PROBE_SUCCESS, changes=[], artifacts=[], issues=[], verification=[the peer participant ID whose message you actually received]. The lead waits for both worker results, then submits the same summary with verification listing both worker participant IDs. Use task_wait/inspect for actual observations, never invent receipt. After submission continue task_wait until the user requests cancellation. Keep the original repository unchanged.`;
    const task=await client.createTask({title:"MCW provider cooperation probe",brief,lead:{provider:"claude",profileId:"probe-claude",hostId:"provider-probe"},workers:[{provider:"codex",profileId:"probe-codex"},{provider:"claude",profileId:"probe-claude"}]});taskId=task.id;
    await client.startTask(task.id,{repositoryPath:repo,expectedHead:head,profiles:task.participants.map(member=>({participantId:member.id,executable:executables.agents[member.provider]!,profile:{id:member.profileId,agentId:member.provider,name:"CLI configured default",model:null,effort:null}}))});
    const deadline=Date.now()+150_000;
    let wakeAfter:number|undefined;
    while(Date.now()<deadline){
      await executor.reconcile();
      const current=await client.inspectTask(task.id);
      await fs.writeFile(path.join(root,"task-proof.json"),JSON.stringify(current,null,2),{mode:0o600});
      if(current.results.length===3){
        const workers=current.participants.filter(member=>member.role==="worker");
        for(const worker of workers){
          const peer=workers.find(peer=>peer.id!==worker.id)!;
          expect(current.events.some(event=>event.kind==="message"&&event.from===worker.id&&event.to===peer.id&&event.text.includes("PEER_HELLO"))).toBe(true);
          expect(current.results.find(result=>result.source.participantId===worker.id)?.verification.join(" ")).toContain(peer.id);
        }
        expect(new Set(current.results.map(result=>result.source.participantId)).size).toBe(3);
        expect(current.results.every(result=>result.summary.includes("MCW_PROVIDER_PROBE_SUCCESS")&&result.integration==="unintegrated"&&result.review==="pending")).toBe(true);
        if(wakeAfter===undefined){
          wakeAfter=current.events.at(-1)!.sequence;
          await client.request(`/tasks/${task.id}/message`,"POST",{text:"All participants: after receiving this user message, broadcast MCW_WAKE_CONFIRMED once. Do not submit another result. Then return to task_wait until cancellation."});
        }else if(current.participants.every(member=>current.events.some(event=>event.sequence>wakeAfter!&&event.from===member.id&&event.kind==="message"&&event.text.includes("MCW_WAKE_CONFIRMED")))){
          expect(await fs.readFile(path.join(root,"mcp-request-shapes.jsonl"),"utf8")).toContain('"tool":"task_wait"');
          expect((await git("status","--porcelain")).stdout).toBe("");return;
        }
      }
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    throw new Error(`Provider cooperation incomplete; inspect the preserved task and terminal evidence at ${root}`);
  } finally {
    // These IDs are admitted only by the disposable fixture's private broker.
    if(client&&taskId)await client.request(`/tasks/${taskId}/cancel`,"POST",{}).catch(()=>{});
    for(const terminal of await terminals.list()){
      try{const frame=await terminals.snapshot(terminal.id);await fs.writeFile(path.join(root,`${terminal.kind}-${terminal.id}.txt`),frame.surface.frame.cells.map(cell=>cell.symbol).join(""),{mode:0o600});}catch{}
      await terminals.stop(terminal.id).catch(()=>{});
    }
    try{await gateway.close();await terminals.close(true);}finally{
      requests.mockRestore();for(const file of privateFiles)await fs.rm(file,{force:true});
    }
  }
},210_000);
