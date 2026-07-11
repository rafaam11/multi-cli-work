import type {
  TerminalAttachment,
  TerminalLaunchSpec,
  TerminalSession,
  TerminalWorkerEvent,
  TerminalWorkerRequest,
} from "../../shared/terminal-types";
import { TerminalWorkerClient, type TerminalWorkerTransport } from "./terminal-worker-client";

export interface RestartableTerminalWorkerTransport extends TerminalWorkerTransport {
  postMessage(message: TerminalWorkerRequest): void;
  kill(): boolean;
}

export class RestartingTerminalWorker {
  private readonly eventSubscribers = new Set<(event: TerminalWorkerEvent) => void>();
  private readonly exitSubscribers = new Set<(code: number) => void>();
  private transport: RestartableTerminalWorkerTransport | null = null;
  private client: TerminalWorkerClient | null = null;
  private restartError: unknown;
  private disposed = false;

  constructor(private readonly spawn: () => RestartableTerminalWorkerTransport) {
    this.start();
  }

  create(spec: TerminalLaunchSpec): Promise<TerminalSession> {
    return this.requireClient().create(spec);
  }

  attach(sessionId: string): Promise<TerminalAttachment> {
    return this.requireClient().attach(sessionId);
  }

  write(sessionId: string, data: string): Promise<void> {
    return this.requireClient().write(sessionId, data);
  }

  resize(sessionId: string, cols: number, rows: number): Promise<void> {
    return this.requireClient().resize(sessionId, cols, rows);
  }

  stop(sessionId: string): Promise<void> {
    return this.requireClient().stop(sessionId);
  }

  onEvent(listener: (event: TerminalWorkerEvent) => void): () => void {
    this.eventSubscribers.add(listener);
    return () => this.eventSubscribers.delete(listener);
  }

  onExit(listener: (code: number) => void): () => void {
    this.exitSubscribers.add(listener);
    return () => this.exitSubscribers.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.client = null;
    const transport = this.transport;
    this.transport = null;
    transport?.kill();
  }

  private start(): void {
    const transport = this.spawn();
    const client = new TerminalWorkerClient(transport);
    this.transport = transport;
    this.client = client;
    this.restartError = undefined;
    client.onEvent((event) => {
      if (this.client !== client || this.disposed) return;
      for (const listener of this.eventSubscribers) listener(event);
    });
    client.onExit((code) => {
      if (this.client !== client || this.disposed) return;
      this.client = null;
      this.transport = null;
      try {
        this.start();
      } catch (error) {
        this.restartError = error;
        console.error("Terminal worker restart failed", error);
      }
      for (const listener of this.exitSubscribers) listener(code);
    });
  }

  private requireClient(): TerminalWorkerClient {
    if (this.disposed) throw new Error("Terminal worker is disposed");
    if (this.client) return this.client;
    throw new Error(
      this.restartError instanceof Error
        ? `Terminal worker is unavailable: ${this.restartError.message}`
        : "Terminal worker is unavailable",
    );
  }
}
