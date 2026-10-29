// @vitest-environment node
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { createServer, connect } from "node:net";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { HostGateway } from "./gateway";
import { TaskStore } from "./task-store";
import { connectSshHost } from "./ssh-host";

const exec=promisify(execFile);
it.skipIf(process.platform!=="linux"||process.env.MCW_SSH_TEST!=="1")("discovers and observes a host through actual strict OpenSSH without owning its lifetime",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"mcw-sshd-test-"));
  const key=path.join(root,"server-key"),identity=path.join(root,"client-key"),config=path.join(root,"sshd.conf"),pidFile=path.join(root,"sshd.pid");
  const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,"127.0.0.1",resolve));const address=reservation.address();
  if(!address||typeof address==="string")throw Error("Fixture port unavailable");const port=address.port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
  let gateway:HostGateway|undefined,ssh:Awaited<ReturnType<typeof connectSshHost>>|undefined;
  let sshd:ReturnType<typeof spawn>|undefined;let diagnostic="";
  try{
    await exec("ssh-keygen",["-q","-t","ed25519","-N","","-f",key]);await exec("ssh-keygen",["-q","-t","ed25519","-N","","-f",identity]);
    const knownHostsFile=path.join(root,"known_hosts");await writeFile(knownHostsFile,`[127.0.0.1]:${port} ${await readFile(key+".pub","utf8")}`,{mode:0o600});
    const authorized=path.join(root,"authorized_keys");await writeFile(authorized,await readFile(identity+".pub"),{mode:0o600});
    await writeFile(config,[`Port ${port}`,"ListenAddress 127.0.0.1",`HostKey ${key}`,`PidFile ${pidFile}`,`AuthorizedKeysFile ${authorized}`,"PasswordAuthentication no","KbdInteractiveAuthentication no","PubkeyAuthentication yes","UsePAM yes","StrictModes no","AllowTcpForwarding local","GatewayPorts no","PermitUserEnvironment no",`AllowUsers ${os.userInfo().username}`].join("\n")+"\n",{mode:0o600});
    sshd=spawn("sudo",["-n","/usr/sbin/sshd","-D","-e","-f",config],{stdio:["ignore","ignore","pipe"]});sshd.stderr?.on("data",data=>{diagnostic=(diagnostic+String(data)).slice(-4000);});
    await expect.poll(async()=>{if(sshd?.exitCode!==null)throw Error(diagnostic);return new Promise<boolean>(resolve=>{const socket=connect(port,"127.0.0.1");socket.once("connect",()=>{socket.destroy();resolve(true);});socket.once("error",()=>resolve(false));});},{timeout:10000}).toBe(true);
    const directory=path.join(root,"host");gateway=new HostGateway({directory,store:new TaskStore({directory,hostId:"ssh-fixture"}),terminals:{list:async()=>[],create:async()=>{throw Error("No execution authorized");},stop:async()=>{},snapshot:async()=>({}),subscribeFrames:()=>()=>{},input:async()=>{},resize:async()=>{},scroll:async()=>{},takeOwnership:async()=>{},releaseOwnership:async()=>{}}});
    const descriptor=await gateway.start();
    const choice={hostId:"ssh-fixture",destination:"127.0.0.1",port,username:os.userInfo().username,identityFile:identity,knownHostsFile,platform:"linux" as const,nodeExecutable:process.execPath,hostEntrypoint:path.resolve("build/v2/host/mcw-host.js"),dataRoot:directory};
    ssh=await connectSshHost(choice);expect((await ssh.client.health()).instanceId).toBe(descriptor.instanceId);
    const events:unknown[]=[];const watcher=ssh.client.watch(event=>events.push(event));await expect.poll(()=>events.some(event=>(event as {type:string}).type==="state")).toBe(true);watcher.close();
    await ssh.close();ssh=undefined;expect((await fetch(descriptor.url+"/health",{headers:{authorization:`Bearer ${descriptor.token}`}})).status).toBe(200);
    await chmod(knownHostsFile,0o600);await writeFile(knownHostsFile,`[127.0.0.1]:${port} ${await readFile(identity+".pub","utf8")}`);
    await expect(connectSshHost(choice)).rejects.toThrow(/discovery failed/);
  }finally{
    await ssh?.close();await gateway?.close();
    // Stop only this fixture's sshd, after comparing its live command line to our config path.
    const pid=Number(await readFile(pidFile,"utf8").catch(()=>""));
    if(Number.isSafeInteger(pid)&&pid>0){const command=await exec("sudo",["-n","cat",`/proc/${pid}/cmdline`]).catch(()=>({stdout:""}));if(!command.stdout.includes(config))throw Error("Fixture sshd identity changed; refusing cleanup signal");await exec("sudo",["-n","kill","-TERM",String(pid)]);}
    if(sshd)await new Promise<void>(resolve=>{if(sshd!.exitCode!==null)resolve();else{sshd!.once("exit",()=>resolve());setTimeout(resolve,3000).unref();}});
    await rm(root,{recursive:true,force:true});
  }
},30000);
