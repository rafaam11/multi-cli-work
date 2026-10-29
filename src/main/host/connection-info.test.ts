// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { HostGateway } from "./gateway";
import { TaskStore } from "./task-store";
import { readConnectionInfo } from "./connection-info";

const cleanup:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
it("exports only a live authenticated descriptor for the expected host and never creates a missing host",async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"mcw-discovery-"));cleanup.push(()=>rm(directory,{recursive:true,force:true}));
  await expect(readConnectionInfo(directory,"pc-a")).rejects.toThrow(/running/i);
  const gateway=new HostGateway({directory,store:new TaskStore({directory,hostId:"pc-a"}),terminals:{list:async()=>[],create:async()=>{throw Error("must not create");},stop:async()=>{},snapshot:async()=>({}),subscribeFrames:()=>()=>{},input:async()=>{},resize:async()=>{},scroll:async()=>{},takeOwnership:async()=>{},releaseOwnership:async()=>{}}});
  cleanup.push(()=>gateway.close());const descriptor=await gateway.start();
  expect(await readConnectionInfo(directory,"pc-a")).toEqual(descriptor);
  await expect(readConnectionInfo(directory,"wrong-pc")).rejects.toThrow(/identity/i);
  await writeFile(path.join(directory,"mcw-host.json"),JSON.stringify({...descriptor,instanceId:"stale"}));
  await expect(readConnectionInfo(directory,"pc-a")).rejects.toThrow(/instance/i);
  await writeFile(path.join(directory,"mcw-host.json"),JSON.stringify(descriptor));
});
