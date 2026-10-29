// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createServer, connect, type Server } from "node:net";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { HostGateway } from "./gateway";
import { TaskStore } from "./task-store";
import { buildSshArguments, connectSshHost, remoteDescriptorCommand, type SshHostConfiguration } from "./ssh-host";

const configuration:SshHostConfiguration={hostId:"remote-pc",destination:"lab-pc",platform:"linux",nodeExecutable:"/opt/mcw/node",hostEntrypoint:"/opt/mcw/mcw-host.js",dataRoot:"/home/me/.mcw-v2/host"};
const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
it("uses strict noninteractive SSH and isolates loopback forwarding without extra configured commands",()=>{
  const args=buildSshArguments(configuration);
  expect(args).toEqual(expect.arrayContaining(["BatchMode=yes","StrictHostKeyChecking=yes","ExitOnForwardFailure=yes","ForwardAgent=no","PermitLocalCommand=no","ControlMaster=no","ControlPath=none"]));
  expect(()=>buildSshArguments({...configuration,destination:"-oProxyCommand=evil"})).toThrow();
  expect(()=>buildSshArguments({...configuration,destination:"pc;echo evil"})).toThrow();
  expect(()=>buildSshArguments({...configuration,port:0})).toThrow();
});
it("quotes Unix paths and encodes Windows commands without passing descriptor credentials in argv",()=>{
  const linux=remoteDescriptorCommand({...configuration,dataRoot:"/home/me/it's $(never) `run`"});
  expect(linux).toContain("'\"'\"'");expect(linux).toContain("--connection-info");
  const windows=remoteDescriptorCommand({...configuration,platform:"win32",nodeExecutable:"C:\\Program Files\\MCW\\node.exe",hostEntrypoint:"C:\\MCW\\mcw-host.js",dataRoot:"C:\\Users\\o'neil\\MCW"});
  const script=Buffer.from(windows.split(" ").at(-1)!,"base64").toString("utf16le");
  expect(script).toContain("o''neil");expect(script).toContain("$LASTEXITCODE");expect(windows).not.toContain("o'neil");
});
it("authenticates a tunneled host with its original HTTP authority and closes only the SSH transport",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"mcw-ssh-host-"));cleanup.push(()=>rm(root,{recursive:true,force:true}));
  const gateway=new HostGateway({directory:root,store:new TaskStore({directory:root,hostId:configuration.hostId}),terminals:{list:async()=>[],create:async()=>({}),stop:async()=>{},snapshot:async()=>({}),subscribeFrames:()=>()=>{},input:async()=>{},resize:async()=>{},scroll:async()=>{},takeOwnership:async()=>{},releaseOwnership:async()=>{}}});
  cleanup.push(()=>gateway.close());const descriptor=await gateway.start();let relay:Server|undefined;
  const sockets=new Set<ReturnType<typeof connect>>();
  const child=Object.assign(new EventEmitter(),{pid:12345,stderr:new PassThrough(),exitCode:null as number|null,signalCode:null,killed:false,kill:vi.fn(()=>{child.killed=true;for(const socket of sockets)socket.destroy();relay?.close(()=>{child.exitCode=0;child.emit("exit",0,null);});return true;})});
  cleanup.push(async()=>{if(!child.killed)child.kill();});
  const spawn=vi.fn((_binary:string,args:string[])=>{
    const forward=args[args.indexOf("-L")+1].split(":");
    relay=createServer(socket=>{const target=connect(Number(new URL(descriptor.url).port),"127.0.0.1");sockets.add(socket);sockets.add(target);socket.on("error",()=>{});target.on("error",()=>{});socket.pipe(target).pipe(socket);});
    relay.listen(Number(forward[1]),forward[0]);return child;
  });
  const connection=await connectSshHost(configuration,{read:async()=>JSON.stringify(descriptor),spawn:spawn as never});
  expect((await connection.client.health()).hostId).toBe(configuration.hostId);
  const events:unknown[]=[];const viewer=connection.client.watch(event=>events.push(event));
  await vi.waitFor(()=>expect(events).toContainEqual(expect.objectContaining({type:"state"})));viewer.close();
  expect(spawn.mock.calls[0][1].join(" ")).not.toContain(descriptor.token);
  await connection.close();expect(child.kill).toHaveBeenCalledOnce();
  expect((await fetch(descriptor.url+"/health",{headers:{authorization:`Bearer ${descriptor.token}`}})).status).toBe(200);
});
it("rejects another host or non-loopback descriptor before opening a tunnel and hides secret output",async()=>{
  const descriptor={schemaVersion:2,pid:1,hostId:"other",instanceId:"i",url:"http://127.0.0.1:43210",token:"x".repeat(43),startedAt:1};const spawn=vi.fn();
  await expect(connectSshHost(configuration,{read:async()=>JSON.stringify(descriptor),spawn:spawn as never})).rejects.toThrow(/identity/i);
  await expect(connectSshHost(configuration,{read:async()=>JSON.stringify({...descriptor,hostId:configuration.hostId,url:"http://public.example:43210"}),spawn:spawn as never})).rejects.toThrow(/loopback/i);
  await expect(connectSshHost(configuration,{read:async()=>{throw new Error(descriptor.token);},spawn:spawn as never})).rejects.not.toThrow(descriptor.token);
  expect(spawn).not.toHaveBeenCalled();
});
