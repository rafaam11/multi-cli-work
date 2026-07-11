import { randomUUID } from "node:crypto";
import type {
  TerminalAttachment,
  TerminalLaunchSpec,
  TerminalSession,
  TerminalWorkerEvent,
  TerminalWorkerRequest,
  TerminalWorkerResponse,
} from "../../shared/terminal-types";

export interface TerminalWorkerTransport {
  postMessage(message: TerminalWorkerRequest): void;
  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
}

interface TerminalWorkerClientOptions {
  idFactory?: () => string;
  timeoutMs?: number;
}

interface PendingCall {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

function isWorkerResponse(message: unknown): message is TerminalWorkerResponse {
  return (
    typeof message === "object" &&
    message !== null &&
    typeof (message as { requestId?: unknown }).requestId === "string" &&
    typeof (message as { ok?: unknown }).ok === "boolean"
  );
}

function isWorkerEvent(message: unknown): message is TerminalWorkerEvent {
  if (typeof message !== "object" || message === null) return false;
  const type = (message as { type?: unknown }).type;
  return type === "data" || type === "status" || type === "exit";
}

export class TerminalWorkerClient {
  private readonly pending = new Map<string, PendingCall>();
  private readonly subscribers = new Set<(event: TerminalWorkerEvent) => void>();
  private readonly idFactory: () => string;
  private readonly timeoutMs: number;

  constructor(
    private readonly worker: TerminalWorkerTransport,
    options: TerminalWorkerClientOptions = {},
  ) {
    this.idFactory = options.idFactory ?? randomUUID;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    worker.on("message", (message) => this.handleMessage(message));
    worker.on("exit", (code) => this.handleExit(code));
  }

  create(spec: TerminalLaunchSpec): Promise<TerminalSession> {
    return this.call((requestId) => ({ requestId, type: "create", spec }));
  }

  attach(sessionId: string): Promise<TerminalAttachment> {
    return this.call((requestId) => ({ requestId, type: "attach", sessionId }));
  }

  write(sessionId: string, data: string): Promise<void> {
    return this.call((requestId) => ({ requestId, type: "write", sessionId, data }));
  }

  resize(sessionId: string, cols: number, rows: number): Promise<void> {
    return this.call((requestId) => ({ requestId, type: "resize", sessionId, cols, rows }));
  }

  stop(sessionId: string): Promise<void> {
    return this.call((requestId) => ({ requestId, type: "stop", sessionId }));
  }

  onEvent(listener: (event: TerminalWorkerEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  private call<T>(buildRequest: (requestId: string) => TerminalWorkerRequest): Promise<T> {
    const requestId = this.idFactory();
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Terminal worker request timed out: ${requestId}`));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timeout });
      this.worker.postMessage(buildRequest(requestId));
    });
  }

  private handleMessage(message: unknown): void {
    if (isWorkerResponse(message)) {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.requestId);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error));
      return;
    }
    if (isWorkerEvent(message)) this.subscribers.forEach((listener) => listener(message));
  }

  private handleExit(code: number): void {
    const error = new Error(`Terminal worker exited with code ${code}`);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

