import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isIP } from "node:net";
import lockfile from "proper-lockfile";
import { WebSocket, WebSocketServer } from "ws";
import { TaskStore } from "./task-store";
import { isFetchPort } from "./http-port";
import { TaskMcpServer } from "../mcw-task-mcp";
import {attemptNeedsObservation,recoveryWorkInventory,recoveryTasksReady} from "../recovery/work-inventory";
import {RecoveryWorkHolds,validateRecoveryHold} from "../recovery/work-holds";
import {readTaskMcpConnection} from "./task-mcp-connection";
import type { AttemptRef, TaskCreateInput, TaskIdentity,Task } from "../../shared/host-types";
import type { LocalHostConnection, HostRegistration } from "../../shared/host-connection-types";
import type { HostConnections } from "./host-connections";
import type { HostTerminalSocket } from "./host-client";
import { resolveRemoteSession } from "../v2/observed-terminals";
import { validateTaskSnapshot,validateTaskIdentity } from "./task-validation";
import type {HostExecutionCatalog} from "./execution-catalog";
import {parseExecutionCatalog,parseExecutionHosts} from "../../shared/execution-catalog";
import type {RegisteredTaskStart} from "../../shared/execution-catalog";
import type {WorkerExecutor} from "./worker-executor";
import type {WorkerReplicas,WorkerReplica} from "./worker-replicas";
import type {WorkerTransfer} from "../../shared/remote-task-types";

/** The independent daemon owns this service. Closing a viewer never stops a session. */
export interface HostTerminalService {
  refreshObservation?():Promise<void>;
  onChange?(callback: () => void): () => void;
  list(): Promise<unknown[]>;
  create(input: Record<string, unknown>): Promise<unknown>;
  stop(sessionId: string): Promise<void>;
  snapshot(sessionId: string): Promise<unknown>;
  subscribeFrames(sessionId: string, callback: (frame: unknown) => void): () => void;
  input(sessionId: string, viewerId: string, data: unknown): Promise<void>;
  resize(sessionId: string, viewerId: string, cols: number, rows: number, cellWidthPx?: number, cellHeightPx?: number): Promise<void>;
  scroll(sessionId: string, viewerId: string, delta: number): Promise<void>;
  takeOwnership(sessionId: string, viewerId: string): Promise<void>;
  releaseOwnership(sessionId: string, viewerId: string): Promise<void>;
}
export interface HostDescriptor { schemaVersion: 2; pid: number; instanceId: string; hostId: string; url: string; token: string; startedAt: number }
interface Credentials { schemaVersion: 2; owner: string; capabilities: { token: string; identity: TaskIdentity;scope?:"replica" }[] }
export interface HostGatewayOptions {
  directory: string; store: TaskStore; terminals: HostTerminalService;
  bindAddress?: string; port?: number; allowRemote?: boolean; advertisedHost?: string; allowedOrigins?: string[];
  maxBodyBytes?: number;
  onShutdown?: () => Promise<void>;
  /** Runs after the singleton daemon lock, before routes/readiness become visible. */
  prepare?: () => Promise<void>;
  startTask?: (taskId: string, input: unknown) => Promise<unknown>;
  executionCatalog?:Pick<HostExecutionCatalog,"read"|"inspectRepository"|"validateCreate"|"prepare">;
  workers?:Pick<WorkerExecutor,"prepare"|"admit">&{replicas:WorkerReplicas};
  hosts?: Pick<HostConnections,"snapshot"|"registrations"|"configure"|"remove"|"onChange"|"client">;
  connectionInfo?:()=>LocalHostConnection;
}
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const secret = () => randomBytes(32).toString("base64url");
const equal = (left: string, right: string) => { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); };
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
export const hostDescriptorPath = (directory: string) => path.join(directory, "mcw-host.json");
export async function writePrivateJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" }); await fs.rename(temporary, file); await fs.chmod(file, 0o600); }
  finally { await fs.rm(temporary, { force: true }); }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Expected JSON object");
  return value as Record<string, unknown>;
}
function exactObject(value:unknown,fields:string[]):Record<string,unknown>{const result=object(value);if(Object.keys(result).sort().join(",")!==fields.sort().join(","))throw new HttpError(400,"Unexpected request fields");return result;}
function workerTransfer(record:WorkerReplica):WorkerTransfer{return {id:record.id,ownerHostId:record.ownerHostId,identity:record.identity,selection:record.selection,attempt:record.attempt,pending:record.operations.filter(item=>!item.acknowledged).map(item=>item.operation)};}
function text(value: unknown, max = 256): string { if (typeof value !== "string" || !value.length || value.length > max || /[\x00-\x1f]/.test(value)) throw new HttpError(400, "Invalid text"); return value; }
function integer(value: unknown, min: number, max: number): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new HttpError(400, "Invalid integer"); return value; }
function bearer(request: IncomingMessage): string | undefined { const value = request.headers.authorization; return value?.startsWith("Bearer ") ? value.slice(7) : undefined; }
async function body(request: IncomingMessage, limit: number): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "JSON content type required");
  if (Number(request.headers["content-length"] ?? 0) > limit) { request.resume(); throw new HttpError(413, "Request too large"); }
  const buffers: Buffer[] = []; let size = 0;
  for await (const chunk of request) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > limit) { request.resume(); throw new HttpError(413, "Request too large"); } buffers.push(buffer); }
  try { return JSON.parse(Buffer.concat(buffers).toString("utf8")); } catch { throw new HttpError(400, "Invalid JSON"); }
}
function reply(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" }); response.end(JSON.stringify(value));
}
/** Host/token checks precede every route and upgrade, including health. No URL carries a secret. */
export class HostGateway {
  private readonly server = createServer((request, response) => { void this.route(request, response); });
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  private readonly owners = new Map<string, string>();
  private credentials!: Credentials;
  private releaseLock?: () => Promise<void>;
  private descriptorValue?: HostDescriptor;
  private accepting = true;
  private manuallyDraining=false;
  private readonly recoveryHolds:RecoveryWorkHolds;
  private readonly limit: number;
  private closing?: Promise<void>;
  private authWrites = Promise.resolve();
  private pendingCreates = 0;
  constructor(readonly options: HostGatewayOptions) {
    this.recoveryHolds=new RecoveryWorkHolds(options.directory);
    this.limit = options.maxBodyBytes ?? 262144;
    this.server.requestTimeout = 65000; this.server.headersTimeout = 10000;
    this.server.on("upgrade", (request, socket, head) => {
      try { const url = this.validateRequest(request); if (url.pathname !== "/terminal" || this.closing) throw new HttpError(404, "Unknown endpoint"); }
      catch { socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return; }
      this.sockets.handleUpgrade(request, socket, head, websocket => this.connect(websocket, bearer(request)));
    });
  }
  get descriptor(): HostDescriptor { if (!this.descriptorValue) throw new Error("Host is not ready"); return { ...this.descriptorValue }; }
  async start(): Promise<HostDescriptor> {
    if (this.descriptorValue) throw new Error("Host already started");
    const address = this.options.bindAddress ?? "127.0.0.1";
    if (this.options.port && !isFetchPort(this.options.port)) throw new Error("Host port is blocked by Fetch");
    const local = address === "127.0.0.1" || address === "::1";
    if (!isIP(address) || (!local && (!this.options.allowRemote || !this.options.advertisedHost))) throw new Error("Remote hosting requires an explicit IP, allowRemote and advertisedHost");
    const advertised = this.options.advertisedHost ?? address;
    if (!/^(?:[a-zA-Z0-9.-]+|[0-9a-fA-F:]+)$/.test(advertised) || advertised === "0.0.0.0" || advertised === "::") throw new Error("Invalid advertised host");
    await fs.mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    await fs.chmod(this.options.directory, 0o700);
    this.releaseLock = await lockfile.lock(path.join(this.options.directory, "mcw-host-runtime"), { realpath: false, retries: 0, stale: 10000 });
    try {
      const credentialsFile = path.join(this.options.directory, "mcw-host-auth.json");
      try {
        const parsed = JSON.parse(await fs.readFile(credentialsFile, "utf8")) as Credentials;
        if (parsed.schemaVersion !== 2 || !/^[A-Za-z0-9_-]{43}$/.test(parsed.owner) || !Array.isArray(parsed.capabilities) || parsed.capabilities.some(capability => !/^[A-Za-z0-9_-]{43}$/.test(capability.token) || !capability.identity)) throw new Error("Invalid host credentials");
        for(const capability of parsed.capabilities){validateTaskIdentity(capability.identity);if(capability.scope!==undefined&&capability.scope!=="replica")throw new Error("Invalid capability scope");}
        this.credentials = parsed; await fs.chmod(credentialsFile, 0o600);
      } catch (error) { if (!missing(error)) throw error; this.credentials = { schemaVersion: 2, owner: secret(), capabilities: [] }; await writePrivateJson(credentialsFile, this.credentials); }
      this.accepting=!await this.recoveryHolds.blocksHost();
      await this.options.prepare?.();
      let listening: ReturnType<typeof this.server.address> = null;
      for (let attempt=0;attempt<10;attempt++) {
        await new Promise<void>((resolve, reject) => { this.server.once("error", reject); this.server.listen(this.options.port ?? 0, address, () => { this.server.off("error", reject); resolve(); }); });
        listening = this.server.address();
        if (!listening || typeof listening === "string") throw new Error("Invalid host address");
        if (isFetchPort(listening.port)) break;
        await new Promise<void>((resolve,reject)=>this.server.close(error=>error?reject(error):resolve()));
      }
      if (!listening || typeof listening === "string" || !isFetchPort(listening.port)) throw new Error("No usable host port was assigned");
      const url = `http://${advertised.includes(":") ? `[${advertised}]` : advertised}:${listening.port}`;
      this.descriptorValue = { schemaVersion: 2, pid: process.pid, instanceId: randomUUID(), hostId: this.options.store.options.hostId, url, token: this.credentials.owner, startedAt: Date.now() };
      await writePrivateJson(hostDescriptorPath(this.options.directory), this.descriptorValue);
      await this.refreshTaskConnections(url);
      return this.descriptor;
    } catch (error) { await this.close(); throw error; }
  }
  private async refreshTaskConnections(url:string):Promise<void>{
    for(const capability of this.credentials.capabilities){
      if(!/^[\w-]{1,128}$/.test(capability.identity.attemptId))continue;
      const file=path.join(this.options.directory,"task-mcp",`${capability.identity.attemptId}.connection.json`);
      // Refresh only the current MCW-owned capability. Preserve unrecognized or
      // replaced files; an old credential must never overwrite a newer one.
      let current:{endpoint:string;token:string};
      try{current=await readTaskMcpConnection(["--connection-file",file],{});}
      catch(error){if(!missing(error))process.stderr.write("Task connection file could not be refreshed; preserved for inspection.\n");continue;}
      if(equal(current.token,capability.token))await writePrivateJson(file,{endpoint:`${url}/mcp`,token:capability.token});
    }
  }
  private validateRequest(request: IncomingMessage): URL {
    const descriptor = this.descriptor;
    const expected = new URL(descriptor.url);
    if (request.headers.host !== expected.host) throw new HttpError(403, "Untrusted host");
    const origin = request.headers.origin;
    if (origin && origin !== expected.origin && !(this.options.allowedOrigins ?? []).includes(origin)) throw new HttpError(403, "Untrusted origin");
    const url = new URL(request.url ?? "/", expected);
    if (url.origin !== expected.origin || url.search || url.hash) throw new HttpError(400, "Unexpected URL");
    return url;
  }
  private authorize(token: string | undefined): { owner: true } | { owner: false; identity: TaskIdentity;scope?:"replica" } {
    if (!token || token.length > 128) throw new HttpError(401, "Authentication required");
    if (equal(token, this.credentials.owner)) return { owner: true };
    const capability = this.credentials.capabilities.find(item => equal(token, item.token));
    if (!capability) throw new HttpError(401, "Authentication required");
    return { owner: false, identity: structuredClone(capability.identity),scope:capability.scope };
  }
  async issueTaskToken(ref: AttemptRef): Promise<string> {
    return this.saveTaskCapability(await this.options.store.bind(ref));
  }
  async issueWorkerTaskToken(ref:AttemptRef):Promise<string>{
    if(!this.options.workers)throw new Error("Worker replicas unavailable");
    return this.saveTaskCapability(await this.options.workers.replicas.bind(ref),"replica");
  }
  private async saveTaskCapability(identity:TaskIdentity,scope?:"replica"):Promise<string>{
    const token = secret();
    const write = this.authWrites.then(async () => { const next = { ...this.credentials, capabilities: [...this.credentials.capabilities, { token, identity,...(scope?{scope}:{}) }] }; await writePrivateJson(path.join(this.options.directory, "mcw-host-auth.json"), next); this.credentials = next; });
    this.authWrites = write.catch(() => undefined); await write;
    return token;
  }
  async revokeTaskToken(token: string): Promise<void> {
    const write = this.authWrites.then(async () => { const next = { ...this.credentials, capabilities: this.credentials.capabilities.filter(item => !equal(item.token, token)) }; await writePrivateJson(path.join(this.options.directory, "mcw-host-auth.json"), next); this.credentials = next; });
    this.authWrites = write.catch(() => undefined); await write;
  }
  drain(): void { this.manuallyDraining=true;this.accepting = false; }
  private async assertAdmission(taskId:string):Promise<void>{if(!this.accepting||await this.recoveryHolds.blocks(taskId))throw new HttpError(409,"Task admission is held for recovery");}
  /** Refuse daemon exit while work is live or its process state is unknown. */
  async canShutdown(): Promise<boolean> {
    try{
    await this.options.terminals.refreshObservation?.();
    const sessions = await this.options.terminals.list();
    const uncertainSession = sessions.some(value => { const session = value as Record<string, unknown> | null; return !session || session.status !== "exited" || session.connected !== true || session.delivery === "unknown" || session.delivery === "pending"; });
    return this.pendingCreates === 0 && !uncertainSession && !(await this.options.store.listForRecovery()).some(task => task.participants.some(participant=>[participant.attempt,...participant.previousAttempts].some(attemptNeedsObservation))) && !(await this.options.workers?.replicas.listForRecovery()??[]).some(replica=>attemptNeedsObservation(replica.attempt)||replica.operations.some(operation=>!operation.acknowledged));
    }catch{return false;}
  }
  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = this.validateRequest(request); const auth = this.authorize(bearer(request)); const method = request.method;
      if (url.pathname === "/mcp" && method === "POST") {
        if (auth.owner) throw new HttpError(403, "Task-scoped capability required");
        const authority=auth.scope==="replica"?this.options.workers?.replicas:this.options.store;
        if(!authority)throw new HttpError(403,"Worker capability unavailable");
        const result = await new TaskMcpServer(authority, auth.identity).handle(await body(request, this.limit));
        reply(response, result === null ? 202 : 200, result); return;
      }
      if (!auth.owner) throw new HttpError(403, "Owner capability required");
      if(url.pathname==="/workers/prepare"&&method==="POST"){
        if(!this.accepting)throw new HttpError(409,"Host is draining");if(!this.options.workers)throw new HttpError(503,"Worker execution unavailable");
        const input=exactObject(await body(request,this.limit),["task","identity","selection"]);this.pendingCreates++;
        try{await this.assertAdmission(text((input.task as Task)?.id));reply(response,200,workerTransfer(await this.options.workers.prepare(input.task as Task,input.identity as TaskIdentity,input.selection as RegisteredTaskStart)));}finally{this.pendingCreates--;}
        return;
      }
      if(url.pathname==="/workers"&&method==="GET"){reply(response,200,(await this.options.workers?.replicas.list()??[]).map(workerTransfer));return;}
      const workerRoute=/^\/workers\/([^/]+)(?:\/(admit|sync))?$/.exec(url.pathname);
      if(workerRoute){
        if(!this.options.workers)throw new HttpError(503,"Worker execution unavailable");
        const id=text(decodeURIComponent(workerRoute[1])),workers=this.options.workers;
        if(!workerRoute[2]&&method==="GET"){reply(response,200,workerTransfer(await workers.replicas.get(id)));return;}
        if(workerRoute[2]==="sync"&&method==="POST"){
          const input=exactObject(await body(request,this.limit),["task","acknowledged"]);
          await workers.replicas.synchronize(id,input.task as Task,input.acknowledged as string[]);reply(response,200,{});return;
        }
        if(workerRoute[2]==="admit"&&method==="POST"){
          if(!this.accepting)throw new HttpError(409,"Host is draining");
          const input=exactObject(await body(request,this.limit),["task","commandId"]);this.pendingCreates++;
          try{const replica=await workers.replicas.get(id);await this.assertAdmission(replica.identity.taskId);reply(response,200,await workers.admit(id,text(input.commandId),input.task as Task));}finally{this.pendingCreates--;}
          return;
        }
        throw new HttpError(405,"Unsupported worker operation");
      }
      if(url.pathname==="/connection"&&method==="GET"){if(!this.options.connectionInfo)throw new HttpError(503,"Host connection info unavailable");reply(response,200,this.options.connectionInfo());return;}
      if(url.pathname==="/hosts"&&method==="GET"){reply(response,200,{registrations:this.options.hosts?.registrations()??[],observations:this.options.hosts?.snapshot()??[]});return;}
      if(url.pathname==="/hosts"&&method==="POST"){
        if(!this.accepting)throw new HttpError(409,"Host is draining");if(!this.options.hosts)throw new HttpError(503,"Host connections unavailable");
        await this.options.hosts.configure(await body(request,this.limit) as HostRegistration);reply(response,200,{});return;
      }
      const workerCatalogRoute=/^(?:\/hosts\/([^/]+))?\/worker-hosts(?:\/([^/]+)\/execution-catalog(?:\/repositories\/([^/]+))?)?$/.exec(url.pathname);
      if(workerCatalogRoute&&method==="GET"){
        const [,ownerEncoded,workerEncoded,repositoryEncoded]=workerCatalogRoute;
        const ownerId=ownerEncoded?text(decodeURIComponent(ownerEncoded)):undefined,workerId=workerEncoded?text(decodeURIComponent(workerEncoded)):undefined,repositoryId=repositoryEncoded?text(decodeURIComponent(repositoryEncoded)):undefined;
        const observedClient=(id:string)=>{
          const observed=this.options.hosts?.snapshot().find(host=>host.hostId===id);
          if(!observed?.enabled||!observed.connected)throw new HttpError(409,"Remote host is not observed");return this.options.hosts!.client(id);
        };
        const owner=ownerId?observedClient(ownerId):undefined;
        if(!workerId){
          const value=owner?await owner.request("/worker-hosts"):(this.options.hosts?.snapshot()??[]).map(host=>({hostId:host.hostId,name:host.name,connected:host.enabled&&host.connected}));
          reply(response,200,parseExecutionHosts(value));return;
        }
        const client=owner??observedClient(workerId),prefix=owner?`/worker-hosts/${encodeURIComponent(workerId)}/execution-catalog`:"/execution-catalog";
        const catalog=parseExecutionCatalog(await client.request(prefix),workerId);
        if(!repositoryId){reply(response,200,catalog);return;}
        const result=object(await client.request(`${prefix}/repositories/${encodeURIComponent(repositoryId)}`)),repository=object(result.repository);
        if(repository.id!==repositoryId||!catalog.repositories.some(repo=>repo.id===repositoryId)||typeof result.expectedHead!=="string"||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result.expectedHead))throw new HttpError(409,"Worker repository inspection changed");
        reply(response,200,{repository:parseExecutionCatalog({...catalog,repositories:[repository]},workerId).repositories[0],expectedHead:result.expectedHead});return;
      }
      const catalogRoute=/^(?:\/hosts\/([^/]+))?\/execution-catalog(?:\/repositories\/([^/]+))?$/.exec(url.pathname);
      if(catalogRoute&&method==="GET"){
        const hostId=catalogRoute[1]?text(decodeURIComponent(catalogRoute[1])):undefined;
        const repositoryId=catalogRoute[2]?text(decodeURIComponent(catalogRoute[2])):undefined;
        if(hostId){
          const observed=this.options.hosts?.snapshot().find(host=>host.hostId===hostId);
          if(!observed?.enabled||!observed.connected)throw new HttpError(409,"Remote host is not observed");
          const client=this.options.hosts!.client(hostId);
          const catalog=parseExecutionCatalog(await client.request("/execution-catalog"),hostId);
          if(!repositoryId){reply(response,200,catalog);return;}
          const result=object(await client.request(`/execution-catalog/repositories/${encodeURIComponent(repositoryId)}`));
          const repository=object(result.repository);
          if(repository.id!==repositoryId||!catalog.repositories.some(repo=>repo.id===repositoryId)||typeof result.expectedHead!=="string"||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result.expectedHead))throw new HttpError(409,"Remote repository inspection changed");
          const checked=parseExecutionCatalog({...catalog,repositories:[repository]},hostId).repositories[0];
          reply(response,200,{repository:checked,expectedHead:result.expectedHead});return;
        }
        if(!this.options.executionCatalog)throw new HttpError(503,"Host execution catalog unavailable");
        reply(response,200,repositoryId?await this.options.executionCatalog.inspectRepository(repositoryId):await this.options.executionCatalog.read());return;
      }
      const remoteTaskRoute=/^\/hosts\/([^/]+)\/tasks(?:\/([^/]+)(?:\/(acknowledge|answer|acknowledge-result|message|cancel|start))?)?$/.exec(url.pathname);
      if(remoteTaskRoute){
        const hostId=text(decodeURIComponent(remoteTaskRoute[1]));
        const observed=this.options.hosts?.snapshot().find(host=>host.hostId===hostId);
        if(!observed)throw new HttpError(404,"Remote host is not registered");
        if(!observed.enabled||!observed.connected)throw new HttpError(409,"Remote host is not observed");
        const remote=this.options.hosts!.client(hostId);
        const validate=(tasks:unknown)=>validateTaskSnapshot({schemaVersion:2,hostId,tasks,outbox:[]}).tasks;
        if(!remoteTaskRoute[2]&&method==="GET"){reply(response,200,validate(await remote.tasks()));return;}
        if(!remoteTaskRoute[2]&&method==="POST"){
          if(!this.accepting)throw new HttpError(409,"Host is draining");
          const input=object(await body(request,this.limit));this.pendingCreates++;
          try{
            const created=await remote.request("/tasks/registered","POST",input);
            reply(response,201,validate([created])[0]);
          }catch{throw new HttpError(502,"원격 응답을 받지 못했습니다. 전달되었을 수 있으니 작업 기록을 확인한 뒤 다시 요청하세요.");}
          finally{this.pendingCreates--;}
          return;
        }
        if(remoteTaskRoute[2]){
          const taskId=text(decodeURIComponent(remoteTaskRoute[2]));
          const task=validate([await remote.inspectTask(taskId)])[0];
          if(task.id!==taskId)throw new HttpError(409,"Remote task identity changed");
          if(!remoteTaskRoute[3]&&method==="GET"){reply(response,200,task);return;}
          if(remoteTaskRoute[3]&&method==="POST"){
            // Owner actions are explicit and never queued/retried. A lost reply
            // must be reconciled by reading that owner's task, not replayed.
            const input=object(await body(request,this.limit));
            const starting=remoteTaskRoute[3]==="start";
            if(starting&&!this.accepting)throw new HttpError(409,"Host is draining");
            if(starting)this.pendingCreates++;
            try{const result=await remote.request(`/tasks/${encodeURIComponent(taskId)}/${starting?"start-registered":remoteTaskRoute[3]}`,"POST",input);reply(response,200,starting?result:{});}
            catch{throw new HttpError(502,"원격 응답을 받지 못했습니다. 전달되었을 수 있으니 작업 기록을 확인한 뒤 다시 요청하세요.");}
            finally{if(starting)this.pendingCreates--;}
            return;
          }
        }
        throw new HttpError(405,"Unsupported remote task operation");
      }
      const hostRoute=/^\/hosts\/([^/]+)$/.exec(url.pathname);
      if(hostRoute&&method==="DELETE"){
        if(!this.accepting)throw new HttpError(409,"Host is draining");if(!this.options.hosts)throw new HttpError(503,"Host connections unavailable");
        await this.options.hosts.remove(text(decodeURIComponent(hostRoute[1])));reply(response,200,{});return;
      }
      if (url.pathname === "/health" && method === "GET") { reply(response, 200, { schemaVersion: 2, hostId: this.descriptor.hostId, instanceId: this.descriptor.instanceId, accepting: this.accepting }); return; }
      if(url.pathname==="/recovery-readiness"&&method==="GET"){reply(response,200,{hostId:this.descriptor.hostId,instanceId:this.descriptor.instanceId,accepting:this.accepting,canShutdown:await this.canShutdown(),checkedAt:Date.now()});return;}
      if(url.pathname==="/recovery-plan"&&method==="GET"){
        const canShutdown=await this.canShutdown();
        const inventory=recoveryWorkInventory(this.descriptor.hostId,await this.options.store.listForRecovery(),(await this.options.workers?.replicas.listForRecovery()??[]).map(replica=>({...replica,pendingOperations:replica.operations.filter(operation=>!operation.acknowledged).length})));
        reply(response,200,{schemaVersion:1,hostId:this.descriptor.hostId,instanceId:this.descriptor.instanceId,accepting:this.accepting,checkedAt:Date.now(),canShutdown,...inventory});return;
      }
      if(url.pathname==="/recovery/holds"&&method==="GET"){reply(response,200,await this.recoveryHolds.list());return;}
      if(url.pathname==="/recovery/holds"&&method==="POST"){
        const input=await body(request,this.limit);validateRecoveryHold(input);
        if(input.taskIds===null){if(input.requesterHostId!==this.descriptor.hostId)throw new HttpError(403,"A host-wide recovery hold must belong to this PC");}
        else {
          const tasks=await this.options.store.list(),replicas=await this.options.workers?.replicas.list()??[];
          if(input.taskIds.some(id=>!tasks.some(task=>task.id===id&&(task.ownerHostId===input.requesterHostId||task.participants.some(member=>member.hostId===input.requesterHostId)))&&!replicas.some(replica=>replica.identity.taskId===id&&(replica.ownerHostId===input.requesterHostId||replica.identity.hostId===input.requesterHostId))))throw new HttpError(403,"Recovery scope does not belong to the requesting PC");
        }
        const hold=await this.recoveryHolds.hold(input);this.accepting=!this.manuallyDraining&&!await this.recoveryHolds.blocksHost();reply(response,201,hold);return;
      }
      const recoveryHoldRoute=/^\/recovery\/holds\/([^/]+)(?:\/(release|readiness))?$/.exec(url.pathname);
      if(recoveryHoldRoute){
        const id=text(decodeURIComponent(recoveryHoldRoute[1]));
        if(!recoveryHoldRoute[2]&&method==="GET"){reply(response,200,await this.recoveryHolds.get(id));return;}
        if(recoveryHoldRoute[2]==="readiness"&&method==="GET"){
          const hold=await this.recoveryHolds.get(id),holdActive=!!hold&&hold.releasedAt===null;
          let ready=false,missingTaskIds:string[]=[];
          if(holdActive&&hold){
            if(hold.taskIds===null)ready=await this.canShutdown();
            else {
              try{
                await this.options.terminals.refreshObservation?.();
                const state=recoveryTasksReady(this.descriptor.hostId,hold.taskIds,await this.options.store.listForRecovery(),(await this.options.workers?.replicas.listForRecovery()??[]).map(replica=>({...replica,pendingOperations:replica.operations.filter(operation=>!operation.acknowledged).length})),await this.options.terminals.list());
                ready=this.pendingCreates===0&&state.ready;missingTaskIds=state.missingTaskIds;
              }catch{ready=false;}
            }
          }
          reply(response,200,{hostId:this.descriptor.hostId,instanceId:this.descriptor.instanceId,holdActive,ready,checkedAt:Date.now(),missingTaskIds});return;
        }
        if(recoveryHoldRoute[2]==="release"&&method==="POST"){
          const input=exactObject(await body(request,this.limit),["requesterHostId"]);
          await this.recoveryHolds.release(id,text(input.requesterHostId));this.accepting=!this.manuallyDraining&&!await this.recoveryHolds.blocksHost();reply(response,200,{released:true});return;
        }
        throw new HttpError(405,"Unsupported recovery hold operation");
      }
      if (url.pathname === "/drain" && method === "POST") { this.drain(); reply(response, 200, { accepting: false }); return; }
      if (url.pathname === "/shutdown" && method === "POST") { this.drain(); if (!await this.canShutdown()) throw new HttpError(409, "Active or unobserved work prevents shutdown"); reply(response, 200, { shutdown: true }); setImmediate(() => { void this.close().then(() => this.options.onShutdown?.()); }); return; }
      if (url.pathname === "/tasks" && method === "GET") { reply(response, 200, await this.options.store.list()); return; }
      if (url.pathname === "/tasks" && method === "POST") { if (!this.accepting) throw new HttpError(409, "Host is draining"); this.pendingCreates++; try { reply(response, 201, await this.options.store.createTask(await body(request, this.limit) as TaskCreateInput)); } finally { this.pendingCreates--; } return; }
      if(url.pathname==="/tasks/registered"&&method==="POST"){
        if(!this.accepting)throw new HttpError(409,"Host is draining");
        if(!this.options.executionCatalog)throw new HttpError(503,"Host execution catalog unavailable");
        this.pendingCreates++;
        try{reply(response,201,await this.options.store.createTask(await this.options.executionCatalog.validateCreate(await body(request,this.limit))));}finally{this.pendingCreates--;}
        return;
      }
      const taskRoute = /^\/tasks\/([^/]+)(?:\/(start|start-registered|message|cancel|capabilities|acknowledge|answer|acknowledge-result))?$/.exec(url.pathname);
      if (taskRoute) {
        const taskId = decodeURIComponent(taskRoute[1]);
        if (!taskRoute[2] && method === "GET") { reply(response, 200, await this.options.store.inspect(taskId)); return; }
        if (method === "POST") {
          const input = object(await body(request, this.limit));
          if (taskRoute[2] === "start"||taskRoute[2]==="start-registered") {
            if (!this.accepting) throw new HttpError(409, "Host is draining");
            if (!this.options.startTask) throw new HttpError(503, "Task execution unavailable");
            this.pendingCreates++;
            try {
              await this.assertAdmission(taskId);
              if(taskRoute[2]==="start-registered"&&!this.options.executionCatalog)throw new HttpError(503,"Host execution catalog unavailable");
              const selected=taskRoute[2]==="start-registered"?await this.options.executionCatalog!.prepare(await this.options.store.inspect(taskId),input):input;
              reply(response, 200, await this.options.startTask(taskId, selected));
            } finally { this.pendingCreates--; }
            return;
          }
          if (taskRoute[2] === "capabilities") { if (!this.accepting) throw new HttpError(409, "Host is draining"); reply(response, 201, { token: await this.issueTaskToken({ taskId, participantId: text(input.participantId), attemptId: text(input.attemptId), generation: integer(input.generation, 1, Number.MAX_SAFE_INTEGER) }) }); return; }
          if (taskRoute[2] === "acknowledge") { await this.options.store.acknowledge(taskId, text(input.eventId)); reply(response, 200, {}); return; }
          if (taskRoute[2] === "acknowledge-result") { await this.options.store.acknowledgeResult(taskId, text(input.resultId)); reply(response, 200, {}); return; }
          if (taskRoute[2] === "answer") { await this.options.store.answerAsUser(taskId, text(input.eventId), text(input.text, 20000)); reply(response, 200, {}); return; }
          if (taskRoute[2] === "message") { await this.options.store.messageAsUser(taskId, text(input.text,20000)); reply(response,200,{});return; }
          if (taskRoute[2] === "cancel") { await this.options.store.cancelAsUser(taskId);reply(response,200,{});return; }
        }
      }
      if (url.pathname === "/terminals" && method === "GET") { reply(response, 200, await this.options.terminals.list()); return; }
      if (url.pathname === "/terminals" && method === "POST") { if (!this.accepting) throw new HttpError(409, "Host is draining"); this.pendingCreates++; try { reply(response, 201, await this.options.terminals.create(object(await body(request, this.limit)))); } finally { this.pendingCreates--; } return; }
      const terminalRoute = /^\/terminals\/([^/]+)$/.exec(url.pathname);
      if (terminalRoute && method === "DELETE") {
        const id=text(decodeURIComponent(terminalRoute[1]));
        if(id.startsWith("mcwr-")){
          const {host,terminal}=resolveRemoteSession(this.options.hosts?.snapshot()??[],id);
          await this.options.hosts!.client(host.hostId).stopTerminal(terminal.id);
        }else await this.options.terminals.stop(id);
        reply(response, 200, {}); return;
      }
      throw new HttpError(404, "Unknown endpoint");
    } catch (error) { if (!response.headersSent) reply(response, error instanceof HttpError ? error.status : 400, { error: error instanceof HttpError ? error.message : "Operation rejected" }); else response.end(); }
  }
  private connect(socket: WebSocket, headerToken?: string): void {
    const viewerId = randomUUID(); let authenticated = false; let sessionId: string | undefined; let unsubscribe: (() => void) | undefined;
    let remote:HostTerminalSocket|undefined,remoteReady=false,remoteEpoch=0;
    const closeRemote=()=>{remoteEpoch++;remoteReady=false;remote?.close();remote=undefined;};
    const send = (value: unknown) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
    const authenticate = (token: string | undefined) => { if (!this.authorize(token).owner) throw new HttpError(403, "Owner capability required"); authenticated = true; clearTimeout(timer); send({ type: "authenticated", viewerId }); };
    const timer = setTimeout(() => socket.close(1008, "Authentication required"), 5000); timer.unref();
    if (headerToken) { try { authenticate(headerToken); } catch { socket.close(1008, "Authentication required"); } }
    let queue = Promise.resolve();
    let stopWatching: (() => void) | undefined;
    socket.on("message", (data, binary) => {
      queue = queue.then(async () => {
        if (binary) throw new HttpError(400, "JSON command required");
        const message = object(JSON.parse(data.toString()));
        if (!authenticated) { if (message.type !== "authenticate") throw new HttpError(401, "Authentication required"); authenticate(text(message.token, 128)); return; }
        if (message.type === "watch") {
          stopWatching?.();
          let stopped = false, dirty = false, reading = false;
          const publish = async () => {
            dirty = true;
            if (reading || stopped) return;
            reading = true;
            try { do {
              dirty = false;
              const [tasks, terminals] = await Promise.all([this.options.store.list(), this.options.terminals.list()]);
              if (!stopped) {
                if (socket.bufferedAmount > 4 * 1024 * 1024) socket.close(1013, "Viewer too slow");
                else send({ type: "state", tasks, terminals, hosts:this.options.hosts?.snapshot()??[], observedAt: Date.now() });
              }
            } while (dirty && !stopped); }
            catch { send({ type: "error", error: "Host state unavailable" }); }
            finally { reading = false; }
          };
          const offTasks = this.options.store.onChange(() => { void publish(); });
          const offTerminals = this.options.terminals.onChange?.(() => { void publish(); });
          const offHosts=this.options.hosts?.onChange(()=>{void publish();});
          stopWatching = () => { stopped = true; offTasks(); offTerminals?.(); offHosts?.(); };
          await publish(); return;
        }
        if (message.type === "subscribe") {
          const nextId = text(message.sessionId);
          if (sessionId && this.owners.get(sessionId) === viewerId) { await this.options.terminals.releaseOwnership(sessionId, viewerId); this.owners.delete(sessionId); }
          closeRemote();unsubscribe?.();unsubscribe=undefined; sessionId = nextId;
          if(nextId.startsWith("mcwr-")){
            try{
              const {host,terminal}=resolveRemoteSession(this.options.hosts?.snapshot()??[],nextId);
              const epoch=remoteEpoch;
              remote=this.options.hosts!.client(host.hostId).terminalSocket(terminal.id,event=>{
                if(epoch!==remoteEpoch||socket.readyState!==WebSocket.OPEN)return;
                if(socket.bufferedAmount>4*1024*1024){socket.close(1013,"Viewer too slow");return;}
                if(event instanceof Uint8Array){socket.send(event,{binary:true});return;}
                const value=event as Record<string,unknown>;
                if(value.type==="authenticated"){remoteReady=true;return;}
                if(value.type==="disconnected"){remoteReady=false;socket.close(1013,"Remote observation disconnected");return;}
                // The remote socket owns its own input lease. Translate only this viewer's ID;
                // another viewer's owner ID stays distinct and cannot grant local control.
                send({...value,sessionId:nextId,...(value.viewerId?{viewerId}:{}),
                  ...("ownerId" in value?{ownerId:value.ownerId===value.viewerId?viewerId:value.ownerId}: {})});
              },()=>socket.close(1013,"Remote terminal unavailable"));
            }catch{socket.close(1013,"Remote host unavailable; reconnect observation");}
            return;
          }
          try {
            // Register first: a frame can arrive while the snapshot promise resolves.
            unsubscribe = this.options.terminals.subscribeFrames(sessionId, frame => { if (socket.readyState === WebSocket.OPEN) { if (socket.bufferedAmount > 4 * 1024 * 1024) socket.close(1013, "Viewer too slow"); else if (frame instanceof Uint8Array) socket.send(frame, { binary: true }); else send({ type: "frame", sessionId, frame }); } });
            const snapshot = await this.options.terminals.snapshot(nextId);
            send({ type: "snapshot", sessionId, snapshot, viewerId, ownerId: this.owners.get(sessionId) ?? null });
          } catch { socket.close(1013,"Terminal surface unavailable; reconnect observation"); }
          return;
        }
        if (!sessionId) throw new HttpError(400, "Subscribe first");
        if(sessionId.startsWith("mcwr-")){
          if(!remoteReady||!remote)throw new HttpError(409,"Remote terminal is not connected");
          if(!["snapshot","input","resize","scroll","takeOwnership","releaseOwnership"].includes(String(message.type)))throw new HttpError(400,"Unknown terminal command");
          remote.send(message);return;
        }
        if (message.type === "takeOwnership") {
          if (this.owners.has(sessionId) && this.owners.get(sessionId) !== viewerId) throw new HttpError(409, "Session already has an owner");
          this.owners.set(sessionId, viewerId);
          try { await this.options.terminals.takeOwnership(sessionId, viewerId); } catch (error) { if (this.owners.get(sessionId) === viewerId) this.owners.delete(sessionId); throw error; }
          send({ type: "ownership", owner: true, viewerId, ownerId: viewerId }); return;
        }
        if (message.type === "snapshot") { send({ type: "snapshot", sessionId, snapshot: await this.options.terminals.snapshot(sessionId), viewerId, ownerId: this.owners.get(sessionId) ?? null }); return; }
        if (this.owners.get(sessionId) !== viewerId) throw new HttpError(403, "Viewer does not own terminal input and size");
        if (message.type === "releaseOwnership") { await this.options.terminals.releaseOwnership(sessionId, viewerId); this.owners.delete(sessionId); send({ type: "ownership", owner: false, viewerId, ownerId: null }); return; }
        if (message.type === "input") { await this.options.terminals.input(sessionId, viewerId, object(message.data)); return; }
        if (message.type === "resize") { await this.options.terminals.resize(sessionId, viewerId, integer(message.cols, 1, 1000), integer(message.rows, 1, 1000), integer(message.cellWidthPx ?? 8, 1, 256), integer(message.cellHeightPx ?? 16, 1, 256)); return; }
        if (message.type === "scroll") { await this.options.terminals.scroll(sessionId, viewerId, integer(message.delta, -100000, 100000)); return; }
        throw new HttpError(400, "Unknown terminal command");
      }).catch(error => { if (!authenticated) socket.close(1008, "Authentication required"); else send({ type: "error", error: error instanceof HttpError ? error.message : "Operation rejected" }); });
    });
    socket.on("error", () => undefined);
    socket.once("close", () => {
      clearTimeout(timer);
      closeRemote();
      stopWatching?.();
      // Await queued input before relinquishing size ownership; never terminate work.
      void queue.finally(async () => { unsubscribe?.(); if (sessionId && this.owners.get(sessionId) === viewerId) { this.owners.delete(sessionId); await this.options.terminals.releaseOwnership(sessionId, viewerId).catch(() => undefined); } });
    });
  }
  /** Close transport only. Session/process shutdown is an explicit separate decision. */
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      this.drain(); for (const socket of this.sockets.clients) socket.terminate();
      await new Promise<void>(resolve => this.sockets.close(() => resolve()));
      await new Promise<void>(resolve => { if (!this.server.listening) resolve(); else { this.server.close(() => resolve()); this.server.closeIdleConnections(); } });
      if (this.descriptorValue) { try { const current = JSON.parse(await fs.readFile(hostDescriptorPath(this.options.directory), "utf8")) as HostDescriptor; if (current.instanceId === this.descriptorValue.instanceId) await fs.rm(hostDescriptorPath(this.options.directory)); } catch (error) { if (!missing(error)) throw error; } }
      await this.releaseLock?.(); this.releaseLock = undefined;
    })();
    return this.closing;
  }
}
