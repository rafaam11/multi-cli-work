import path from "node:path";
import { HostGateway, type HostGatewayOptions } from "./host/gateway";
import { TaskStore } from "./host/task-store";
import { createHerdrTerminalService } from "./herdr/terminal-service";
import { TaskExecutor } from "./host/task-executor";
import { readConnectionInfo } from "./host/connection-info";
import { HostConnections } from "./host/host-connections";
import {HostExecutionCatalog} from "./host/execution-catalog";
import {WorkerReplicas} from "./host/worker-replicas";
import {WorkerExecutor} from "./host/worker-executor";
import {RemoteWorkers} from "./host/remote-workers";
import {parseExecutionCatalog} from "../shared/execution-catalog";
import {recordHostProcessIdentity} from './host/runtime-identity';
import {createHostMobileAccess,type HostMobileConfig} from './host/mobile-access';
import {HostClient} from './host/host-client';

/** Separate Node entrypoint. Importing it never starts a host or touches a user's data. */
export async function startHost(options: HostGatewayOptions): Promise<HostGateway> {
  const gateway = new HostGateway(options); await gateway.start(); return gateway;
}
/** The same adapter is used by the daemon and exercised against the native bridge. */
export function hostTerminalAdapter(get:()=>Awaited<ReturnType<typeof createHerdrTerminalService>>):HostGatewayOptions["terminals"] {
  return {
    acquireCheckoutRemoval:(cwd,id,pid)=>get().acquireCheckoutRemoval(cwd,id,pid),
    releaseCheckoutRemoval:id=>get().releaseCheckoutRemoval(id),
    removeCheckout:(id,repo,cwd,force)=>get().removeCheckout(id,repo,cwd,force),
    checkoutRemovalBusy:()=>get().checkoutRemovalBusy(),
    refreshObservation:()=>get().refreshObservation(), onChange: callback => get().onChange(callback),
    list: () => get().list(), create: input => get().create(input), stop: id => get().stop(id), snapshot: id => get().snapshot(id),
    subscribeFrames: (id, callback) => get().subscribeFrames(id, callback), input: (id, viewer, data) => get().input(id, viewer, data),
    resize: (id, viewer, cols, rows, width, height) => get().resize(id, viewer, cols, rows, width, height), scroll: (id, viewer, delta) => get().scroll(id, viewer, delta),
    clear: (id, viewer) => get().clear(id, viewer), search: (id, viewer, params) => get().search(id, viewer, params),
    selection: (id, viewer, params) => get().selection(id, viewer, params),
    takeOwnership: (id, viewer) => get().takeOwnership(id, viewer), releaseOwnership: (id, viewer) => get().releaseOwnership(id, viewer),
  };
}
export async function runHostProcess(argv: string[] = process.argv.slice(2)): Promise<HostGateway> {
  function option(name: string, required = true): string | undefined {
    const index = argv.indexOf(name); const value = index >= 0 ? argv[index + 1] : undefined;
    if ((!value || value.startsWith("--")) && required) throw new Error(`Missing ${name}`);
    return value && !value.startsWith("--") ? value : undefined;
  }
  const directory = path.resolve(option("--data-root")!); const hostId = option("--host-id")!;
  const config = JSON.parse(option("--terminal-config")!) as Record<string, unknown>;
  if (typeof config.binaryPath !== "string" || typeof config.bridgePath !== "string" || typeof config.binarySha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(config.binarySha256)) throw new Error("Invalid terminal runtime configuration");
  if(config.modsDirectory!==undefined&&(typeof config.modsDirectory!=="string"||!path.isAbsolute(config.modsDirectory)))throw new Error("Invalid managed mods directory");
  const store = new TaskStore({ directory, hostId });
  const replicas=new WorkerReplicas({directory,hostId});
  const hosts=new HostConnections({directory,localHostId:hostId});
  const remoteWorkers=new RemoteWorkers({directory,store,client:id=>hosts.client(id)});
  const catalogPaths=option("--catalog-paths",false);
  const executionCatalog=catalogPaths?new HostExecutionCatalog({...JSON.parse(catalogPaths),hostId,remoteCatalog:async id=>parseExecutionCatalog(await hosts.client(id).request("/execution-catalog"),id)}):undefined;
  // Recover execution observations, never replay or resend commands after a daemon restart.
  let terminals: Awaited<ReturnType<typeof createHerdrTerminalService>> | undefined;
  let executor: TaskExecutor | undefined;
  let workerExecutor:WorkerExecutor|undefined;
  let syncTimer:ReturnType<typeof setInterval>|undefined;
  let stopObservation: (() => void) | undefined;
  let mobile:Awaited<ReturnType<typeof createHostMobileAccess>>|undefined;
  let initialized=false;
  const service = hostTerminalAdapter(()=>terminals!);
  let gateway!: HostGateway;
  const finish = async () => { clearInterval(syncTimer);stopObservation?.();await mobile?.dispose(); await hosts.close(); await terminals?.close(true); process.exit(0); };
  try {
    gateway = await startHost({ directory, store, terminals: service, hosts, executionCatalog,workers:{replicas,prepare:async(...args)=>{if(!workerExecutor)throw new Error("Worker execution unavailable");return workerExecutor.prepare(...args);},admit:async(...args)=>{if(!workerExecutor)throw new Error("Worker execution unavailable");return workerExecutor.admit(...args);}}, connectionInfo:()=>({hostId,platform:process.platform as "win32"|"linux",nodeExecutable:process.execPath,hostEntrypoint:path.join(__dirname,"mcw-host.js"),dataRoot:directory}), bindAddress: option("--bind-address", false), allowRemote: argv.includes("--allow-remote"), advertisedHost: option("--advertised-host", false), onShutdown: finish, startTask: (taskId, input) => executor!.start(taskId, input), prepare: async () => {
      // The gateway already owns the daemon runtime lock. Record the kernel
      // identity before any terminal or work can be started, and retain it on exit.
      await recordHostProcessIdentity(directory,hostId,config.bridgePath as string);
      terminals = await createHerdrTerminalService({ root: directory, binaryPath: config.binaryPath as string, binarySha256: config.binarySha256 as string, bridgePath: config.bridgePath as string, modsDirectory:config.modsDirectory as string|undefined });
      await store.recover();
      await replicas.recover();
      await hosts.start();
    },mobile:()=>mobile,ready:()=>initialized });
    const participantOptions={directory,terminals:service,gatewayUrl:()=>gateway.descriptor.url,mcpClientPath:path.join(__dirname,"mcw-task-mcp-client.js"),mcpElectron:!!process.versions.electron};
    executor = new TaskExecutor({...participantOptions,store,remoteWorkers,issueTaskToken:ref=>gateway.issueTaskToken(ref)});
    workerExecutor=new WorkerExecutor({...participantOptions,replicas,catalog:{prepareWorker:async(...args)=>{if(!executionCatalog)throw new Error("Host execution catalog unavailable");return executionCatalog.prepareWorker(...args);}},issueTaskToken:ref=>gateway.issueWorkerTaskToken(ref)});
    let dirty = false, reconciling = false;
    const reconcile = async () => {
      dirty = true; if (reconciling) return; reconciling = true;
      try { do { dirty = false; await executor!.reconcile();await workerExecutor!.reconcile(); } while (dirty); }
      catch { process.stderr.write("Task observations unavailable; work was not restarted.\n"); }
      finally { reconciling = false; }
    };
    stopObservation = terminals!.onChange(() => { void reconcile(); }); await reconcile();
    const synchronize=()=>{void remoteWorkers.synchronize().catch(()=>process.stderr.write("Remote worker data unavailable; execution was not repeated.\n"));};
    syncTimer=setInterval(synchronize,2000);syncTimer.unref();synchronize();
    const mobileConfig=option('--mobile-config',false);
    if(mobileConfig)mobile=await createHostMobileAccess(new HostClient(gateway.descriptor),hostId,JSON.parse(mobileConfig) as HostMobileConfig);
    initialized=true;
  } catch (error) { clearInterval(syncTimer);stopObservation?.();await mobile?.dispose();await gateway?.close();await hosts.close();await terminals?.close(); throw error; }
  const stop = () => { gateway.drain(); void gateway.canShutdown().then(async safe => { if (safe) { await gateway.close(); await finish(); } }); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  return gateway;
}
if (process.argv.includes("--connection-info")) {
  const args=process.argv.slice(2);
  const value=(flag:string)=>args[args.indexOf(flag)+1];
  void readConnectionInfo(value("--data-root")??"",value("--host-id")??"").then(descriptor=>{
    process.stdout.write(JSON.stringify(descriptor)+"\n");
  }).catch(()=>{process.stderr.write("MCW SSH discovery unavailable; verify the running host and saved identity.\n");process.exitCode=1;});
} else if (process.argv.includes("--mcw-host")) {
  void runHostProcess().catch(error => {
    const details:string[]=[];let cause:unknown=error;
    for(let depth=0;depth<4&&cause instanceof Error;depth++){
      // A JSON parser may echo fragments of private records; keep those out of logs.
      details.push(cause instanceof SyntaxError?'Stored JSON could not be parsed':(cause.stack??cause.message).slice(0,6000));cause=cause.cause;
    }
    process.stderr.write(`mcw-host startup failed; inspect private host state.\n${details.join('\nCaused by: ')}\n`);process.exitCode=1;
  });
}
