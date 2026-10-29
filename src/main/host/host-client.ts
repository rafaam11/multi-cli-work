import { WebSocket } from "ws";
import { request as httpRequest } from "node:http";
import type { AttemptRef, Task, TaskCreateInput } from "../../shared/host-types";
import type { HostDescriptor } from "./gateway";

export interface HostConnection { url: string; token: string; instanceId?: string; /** Original loopback Host header behind an authenticated SSH tunnel. */ authority?: string }
export function ownerTaskRoute(id?:string,hostId?:string):string {
  if(hostId!==undefined&&(typeof hostId!=="string"||!/^[\w-]{1,128}$/.test(hostId)))throw new Error("Invalid host ID");
  if(id!==undefined&&(typeof id!=="string"||!id.trim()||id.length>200||id.includes("\0")))throw new Error("Invalid task ID");
  return `${hostId===undefined?"":`/hosts/${encodeURIComponent(hostId)}`}/tasks${id===undefined?"":`/${encodeURIComponent(id)}`}`;
}
export class HostClient {
  readonly connection: HostConnection;
  constructor(connection: HostConnection) {
    const url = new URL(connection.url);
    if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error("Invalid host URL");
    if (!/^[A-Za-z0-9_-]{43}$/.test(connection.token)) throw new Error("Invalid host token");
    if (connection.authority !== undefined) {
      const target=new URL(`http://${connection.authority}`);
      if (!["127.0.0.1","[::1]"].includes(target.hostname) || target.host!==connection.authority || target.username || target.password) throw new Error("Invalid tunneled host authority");
    }
    this.connection = { token:connection.token, instanceId:connection.instanceId, authority:connection.authority, url:url.origin };
  }
  async request<T>(route: string, method = "GET", input?: unknown, timeoutMs=65000): Promise<T> {
    if (!route.startsWith("/") || route.startsWith("//") || route.includes("?") || route.includes("#")) throw new Error("Invalid host route");
    // Node fetch overwrites Host with the local forwarding port. HTTP preserves
    // the remote authority so the gateway's rebinding check remains effective.
    return new Promise<T>((resolve,reject)=>{
      const request=httpRequest(`${this.connection.url}${route}`,{method,signal:AbortSignal.timeout(timeoutMs),headers:{authorization:`Bearer ${this.connection.token}`,...(this.connection.authority?{host:this.connection.authority}:{}),...(input===undefined?{}:{"content-type":"application/json"})}},response=>{
        const chunks:Buffer[]=[];let bytes=0;
        response.on("error",reject);
        response.on("data",(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>16*1024*1024){request.destroy(new Error("Host response exceeds limit"));return;}chunks.push(chunk);});
        response.on("end",()=>{
          try{const value=JSON.parse(Buffer.concat(chunks).toString("utf8")) as T & {error?:string};if(!response.statusCode||response.statusCode<200||response.statusCode>=300)throw new Error(value.error??`Host rejected request (${response.statusCode})`);resolve(value);}
          catch(error){reject(error);}
        });
      });
      request.on("error",reject);request.end(input===undefined?undefined:JSON.stringify(input));
    });
  }
  async health(): Promise<{ schemaVersion: 2; hostId: string; instanceId: string; accepting: boolean }> {
    const value = await this.request<{ schemaVersion: 2; hostId: string; instanceId: string; accepting: boolean }>("/health","GET",undefined,1000);
    if (this.connection.instanceId && value.instanceId !== this.connection.instanceId) throw new Error("Host instance changed");
    return value;
  }
  /** Replace an observation endpoint only after authenticating the same host's fresh instance. */
  async reconnect(connection: HostConnection, hostId: string): Promise<void> {
    const candidate = new HostClient(connection), health = await candidate.health();
    if (health.schemaVersion !== 2 || health.hostId !== hostId) throw new Error("Host identity changed");
    Object.assign(this.connection, candidate.connection);
  }
  tasks(hostId?:string): Promise<Task[]> { return this.request(ownerTaskRoute(undefined,hostId)); }
  createTask(input: TaskCreateInput): Promise<Task> { return this.request("/tasks", "POST", input); }
  inspectTask(id: string,hostId?:string): Promise<Task> { return this.request(ownerTaskRoute(id,hostId)); }
  startTask(id: string, input: unknown): Promise<unknown> { return this.request(`/tasks/${encodeURIComponent(id)}/start`, "POST", input); }
  watch(onEvent: (event: unknown) => void): HostTerminalSocket { return new HostTerminalSocket(this.connection, null, onEvent); }
  issueTaskToken(ref: AttemptRef): Promise<{ token: string }> { return this.request(`/tasks/${encodeURIComponent(ref.taskId)}/capabilities`, "POST", { participantId: ref.participantId, attemptId: ref.attemptId, generation: ref.generation }); }
  terminals(): Promise<unknown[]> { return this.request("/terminals"); }
  createTerminal(input: Record<string, unknown>): Promise<unknown> { return this.request("/terminals", "POST", input); }
  stopTerminal(sessionId: string): Promise<void> { return this.request(`/terminals/${encodeURIComponent(sessionId)}`, "DELETE"); }
  drain(): Promise<{ accepting: false }> { return this.request("/drain", "POST"); }
  shutdown(): Promise<{ shutdown: true }> { return this.request("/shutdown", "POST"); }
  /** Return transport ownership only. Closing this socket never stops a terminal or task. */
  terminalSocket(sessionId: string, onEvent: (event: unknown) => void, onError?: (message: string) => void): HostTerminalSocket {
    return new HostTerminalSocket(this.connection, sessionId, onEvent, onError);
  }
}

export class HostTerminalSocket {
  private readonly socket: WebSocket;
  private ready = false;
  private closed = false;
  private readonly pending: Record<string, unknown>[] = [];
  constructor(connection: HostConnection, sessionId: string | null, onEvent: (event: unknown) => void, onError?: (message: string) => void) {
    this.socket = new WebSocket(`${connection.url.replace(/^http:/, "ws:")}/terminal`, { perMessageDeflate: false, maxPayload: 16 * 1024 * 1024, ...(connection.authority?{headers:{host:connection.authority}}:{}) });
    this.socket.on("open", () => { this.socket.send(JSON.stringify({ type: "authenticate", token: connection.token })); });
    this.socket.on("message", (data, binary) => {
      try {
        if (binary) { onEvent(new Uint8Array(data as Buffer)); return; }
        const event = JSON.parse(data.toString()) as Record<string, unknown>;
        if (event.type === "authenticated") {
          this.ready = true; this.socket.send(JSON.stringify(sessionId === null ? { type: "watch" } : { type: "subscribe", sessionId }));
          for (const message of this.pending.splice(0)) this.send(message);
        }
        onEvent(event);
      } catch { onError?.("Invalid host terminal frame"); }
    });
    this.socket.on("error", () => onError?.("Host terminal connection failed"));
    this.socket.on("close", () => { this.ready = false; if (!this.closed) onEvent({ type: "disconnected", observedAt: Date.now() }); });
  }
  send(message: Record<string, unknown>): void {
    if (this.closed) throw new Error("Terminal viewer is closed");
    if (!this.ready) { if (this.pending.length >= 64) throw new Error("Terminal is not connected"); this.pending.push(message); return; }
    this.socket.send(JSON.stringify(message));
  }
  close(): void { this.closed = true; this.pending.length = 0; this.socket.close(); }
}
export const clientFromDescriptor = (descriptor: HostDescriptor) => new HostClient(descriptor);
