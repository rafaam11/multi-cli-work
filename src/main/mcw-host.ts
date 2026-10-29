import path from "node:path";
import { HostGateway, type HostGatewayOptions } from "./host/gateway";
import { TaskStore } from "./host/task-store";
import { createHerdrTerminalService } from "./herdr/terminal-service";
import { TaskExecutor } from "./host/task-executor";
import { readConnectionInfo } from "./host/connection-info";
import { HostConnections } from "./host/host-connections";
import {HostExecutionCatalog} from "./host/execution-catalog";

/** Separate Node entrypoint. Importing it never starts a host or touches a user's data. */
export async function startHost(options: HostGatewayOptions): Promise<HostGateway> {
  const gateway = new HostGateway(options); await gateway.start(); return gateway;
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
  const catalogPaths=option("--catalog-paths",false);
  const executionCatalog=catalogPaths?new HostExecutionCatalog({...JSON.parse(catalogPaths),hostId}):undefined;
  // Recover execution observations, never replay or resend commands after a daemon restart.
  let terminals: Awaited<ReturnType<typeof createHerdrTerminalService>> | undefined;
  let executor: TaskExecutor | undefined;
  let stopObservation: (() => void) | undefined;
  const hosts=new HostConnections({directory,localHostId:hostId});
  const service: HostGatewayOptions["terminals"] = {
    onChange: callback => terminals!.onChange(callback),
    list: () => terminals!.list(), create: input => terminals!.create(input), stop: id => terminals!.stop(id), snapshot: id => terminals!.snapshot(id),
    subscribeFrames: (id, callback) => terminals!.subscribeFrames(id, callback), input: (id, viewer, data) => terminals!.input(id, viewer, data),
    resize: (id, viewer, cols, rows, width, height) => terminals!.resize(id, viewer, cols, rows, width, height), scroll: (id, viewer, delta) => terminals!.scroll(id, viewer, delta),
    takeOwnership: (id, viewer) => terminals!.takeOwnership(id, viewer), releaseOwnership: (id, viewer) => terminals!.releaseOwnership(id, viewer),
  };
  let gateway: HostGateway;
  const finish = async () => { stopObservation?.(); await hosts.close(); await terminals?.close(); process.exit(0); };
  try {
    gateway = await startHost({ directory, store, terminals: service, hosts, executionCatalog, connectionInfo:()=>({hostId,platform:process.platform as "win32"|"linux",nodeExecutable:process.execPath,hostEntrypoint:path.join(__dirname,"mcw-host.js"),dataRoot:directory}), bindAddress: option("--bind-address", false), allowRemote: argv.includes("--allow-remote"), advertisedHost: option("--advertised-host", false), onShutdown: finish, startTask: (taskId, input) => executor!.start(taskId, input), prepare: async () => {
      terminals = await createHerdrTerminalService({ root: directory, binaryPath: config.binaryPath as string, binarySha256: config.binarySha256 as string, bridgePath: config.bridgePath as string, modsDirectory:config.modsDirectory as string|undefined });
      await store.recover();
      await hosts.start();
    } });
    executor = new TaskExecutor({ directory, store, terminals: service, issueTaskToken: ref => gateway.issueTaskToken(ref), gatewayUrl: () => gateway.descriptor!.url,
      mcpClientPath: path.join(__dirname, "mcw-task-mcp-client.js"), mcpElectron: !!process.versions.electron });
    let dirty = false, reconciling = false;
    const reconcile = async () => {
      dirty = true; if (reconciling) return; reconciling = true;
      try { do { dirty = false; await executor!.reconcile(); } while (dirty); }
      catch { process.stderr.write("Task observations unavailable; work was not restarted.\n"); }
      finally { reconciling = false; }
    };
    stopObservation = terminals!.onChange(() => { void reconcile(); }); await reconcile();
  } catch (error) { await hosts.close();await terminals?.close(); throw error; }
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
  void runHostProcess().catch(() => { process.stderr.write("mcw-host startup failed; inspect private host state.\n"); process.exitCode = 1; });
}
