// @vitest-environment node
import { mkdtemp,readFile,rm,writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach,expect,it,vi } from "vitest";
import { HostConnections } from "./host-connections";
import type { HostRegistration } from "../../shared/host-connection-types";
const roots:string[]=[];const managers:HostConnections[]=[];
afterEach(async()=>{for(const manager of managers.splice(0))await manager.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});vi.useRealTimers();});
const registration:HostRegistration={name:"Lab",enabled:true,ssh:{hostId:"remote",destination:"lab",platform:"linux",nodeExecutable:"/opt/node",hostEntrypoint:"/opt/mcw-host.js",dataRoot:"/home/me/mcw"}};
it.each(["win32","linux"] as const)("validates %s terminal paths using the remote PC's platform",async platform=>{
  const f=await setup(),root=platform==="win32"?"C:/MCW":"/mcw";
  await f.manager.configure({...registration,ssh:{...registration.ssh,platform,nodeExecutable:`${root}/node`,hostEntrypoint:`${root}/host.js`,dataRoot:root}});
  await vi.waitFor(()=>expect(f.listeners).toHaveLength(1));
  f.listeners[0]({type:"state",tasks:[],terminals:[{id:"s",kind:"codex",cwd:root,projectId:null,createdAt:"2026-10-30T00:00:00Z",generation:"g",tabId:"t",paneId:"p",delivery:"delivered",status:"idle",observedAt:12,connected:true}]});
  expect(f.manager.snapshot()[0]).toMatchObject({connected:true,terminals:[{cwd:root}]});
});
async function setup(){
  const directory=await mkdtemp(path.join(os.tmpdir(),"mcw-host-links-"));roots.push(directory);
  const listeners:((event:unknown)=>void)[]=[],disconnects:(()=>void)[]=[];
  const connection={client:{watch:vi.fn((listener:(event:unknown)=>void)=>{listeners.push(listener);return{close:vi.fn()};})},close:vi.fn(async()=>{})};
  const connect=vi.fn(async(_config:unknown,options:{onDisconnect:()=>void})=>{disconnects.push(options.onDisconnect);return connection;});
  const manager=new HostConnections({directory,localHostId:"local",connect:connect as never,retryMs:10});managers.push(manager);await manager.start();
  return{manager,directory,connection,connect,listeners,disconnects};
}
it("persists selected SSH hosts without credentials and recovers observations without replaying work",async()=>{
  const f=await setup();await f.manager.configure(registration);await vi.waitFor(()=>expect(f.listeners).toHaveLength(1));
  f.listeners[0]({type:"state",tasks:[],terminals:[],observedAt:100});
  const observedAt=f.manager.snapshot()[0].observedAt;expect(observedAt).not.toBeNull();expect(f.manager.snapshot()[0].connected).toBe(true);
  f.disconnects[0]();expect(f.manager.snapshot()[0]).toMatchObject({connected:false,observedAt});
  await vi.waitFor(()=>expect(f.listeners).toHaveLength(2));
  f.listeners[0]({type:"state",tasks:[],terminals:[],observedAt:200});expect(f.manager.snapshot()[0].connected).toBe(false);
  f.listeners[1]({type:"state",tasks:[],terminals:[],observedAt:300});expect(f.manager.snapshot()[0].connected).toBe(true);
  expect(await readFile(path.join(f.directory,"host-connections.json"),"utf8")).not.toMatch(/token|password/);
  await f.manager.configure({...registration,enabled:false});expect(f.manager.snapshot()[0]).toMatchObject({enabled:false,connected:false});
  expect(f.connection.close).toHaveBeenCalled();
});
it("rejects self connections and corrupt registration data without guessing or overwriting",async()=>{
  const f=await setup();await expect(f.manager.configure({...registration,ssh:{...registration.ssh,hostId:"local"}})).rejects.toThrow(/own host/i);
  await writeFile(path.join(f.directory,"host-connections.json"),"broken");
  await expect(f.manager.configure(registration)).rejects.toThrow();expect(f.connect).not.toHaveBeenCalled();
  expect(await readFile(path.join(f.directory,"host-connections.json"),"utf8")).toBe("broken");
});
it("closes a late SSH connection after removal without reviving a deleted host",async()=>{
  const f=await setup();let release!:(value:typeof f.connection)=>void;f.connect.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));
  await f.manager.configure(registration);await vi.waitFor(()=>expect(release).toBeDefined());
  await f.manager.remove("remote");release(f.connection);await vi.waitFor(()=>expect(f.connection.close).toHaveBeenCalled());
  expect(f.manager.snapshot()).toEqual([]);expect(f.connection.client.watch).not.toHaveBeenCalled();
});
it("cancels pending discovery and awaits transport cleanup before daemon shutdown",async()=>{
  const f=await setup();let cancelled=false,finished=false;
  f.connect.mockImplementationOnce((_config,options)=>new Promise((_resolve,reject)=>{
    const signal=(options as {signal?:AbortSignal}).signal;
    signal?.addEventListener("abort",()=>{cancelled=true;setTimeout(()=>{finished=true;reject(new Error("cancelled"));},10);},{once:true});
  }));
  await f.manager.configure(registration);await f.manager.close();
  expect(cancelled).toBe(true);expect(finished).toBe(true);expect(f.manager.snapshot()[0].connected).toBe(false);
});
it("restores last remote observations as disconnected after a daemon restart, without inventing an exit",async()=>{
  const f=await setup();await f.manager.configure(registration);await vi.waitFor(()=>expect(f.listeners).toHaveLength(1));
  const terminal={id:"s",kind:"codex",cwd:"/repo",projectId:null,createdAt:"2026-10-30T00:00:00Z",generation:"g",tabId:"t",paneId:"p",delivery:"delivered",status:"working",observedAt:12,connected:true};
  f.listeners[0]({type:"state",tasks:[],terminals:[terminal]});const seen=f.manager.snapshot()[0].observedAt;
  await f.manager.close();
  const restarted=new HostConnections({directory:f.directory,localHostId:"local",connect:(async()=>{throw Error("offline");}) as never,retryMs:60000});managers.push(restarted);await restarted.start();
  expect(restarted.snapshot()[0]).toMatchObject({connected:false,observedAt:seen,terminals:[{id:"s",status:"working",observedAt:12,connected:false}]});
  expect(()=>restarted.client("remote")).toThrow(/observed/);
});
it("preserves corrupt observation files while allowing independent local work to start",async()=>{
  const f=await setup();await f.manager.configure({...registration,enabled:false});await f.manager.close();
  const file=path.join(f.directory,"host-observations.json");await writeFile(file,"broken primary");await writeFile(file+".bak","broken backup");
  const restarted=new HostConnections({directory:f.directory,localHostId:"local"});managers.push(restarted);await restarted.start();
  expect(restarted.snapshot()[0]).toMatchObject({connected:false,observedAt:null,error:expect.stringContaining("기존 파일")});
  await restarted.close();expect(await readFile(file,"utf8")).toBe("broken primary");expect(await readFile(file+".bak","utf8")).toBe("broken backup");
});
