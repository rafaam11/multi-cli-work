import { WebSocket } from "ws";
import type { AttemptRef, Task, TaskCreateInput } from "../../shared/host-types";
import type { HostDescriptor } from "./gateway";

export interface HostConnection { url: string; token: string; instanceId?: string }
export class HostClient {
  readonly connection: HostConnection;
  constructor(connection: HostConnection) {
    const url = new URL(connection.url);
    if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) throw new Error("Invalid host URL");
    if (!/^[A-Za-z0-9_-]{43}$/.test(connection.token)) throw new Error("Invalid host token");
    this.connection = { ...connection, url: url.origin };
  }
  async request<T>(route: string, method = "GET", input?: unknown): Promise<T> {
    if (!route.startsWith("/") || route.startsWith("//") || route.includes("?") || route.includes("#")) throw new Error("Invalid host route");
    const response = await fetch(`${this.connection.url}${route}`, { method, redirect: "error", signal: AbortSignal.timeout(65000), headers: { authorization: `Bearer ${this.connection.token}`, ...(input === undefined ? {} : { "content-type": "application/json" }) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    const value = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(value.error ?? `Host rejected request (${response.status})`);
    return value;
  }
  async health(): Promise<{ schemaVersion: 2; hostId: string; instanceId: string; accepting: boolean }> {
    const value = await this.request<{ schemaVersion: 2; hostId: string; instanceId: string; accepting: boolean }>("/health");
    if (this.connection.instanceId && value.instanceId !== this.connection.instanceId) throw new Error("Host instance changed");
    return value;
  }
  tasks(): Promise<Task[]> { return this.request("/tasks"); }
  createTask(input: TaskCreateInput): Promise<Task> { return this.request("/tasks", "POST", input); }
  inspectTask(id: string): Promise<Task> { return this.request(`/tasks/${encodeURIComponent(id)}`); }
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
    this.socket = new WebSocket(`${connection.url.replace(/^http:/, "ws:")}/terminal`, { perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });
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
