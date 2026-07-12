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

const MAX_CONSECUTIVE_CRASHES = 5;
const SURVIVAL_RESET_MS = 30_000;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

export class RestartingTerminalWorker {
  private readonly eventSubscribers = new Set<(event: TerminalWorkerEvent) => void>();
  private readonly exitSubscribers = new Set<(code: number) => void>();
  private transport: RestartableTerminalWorkerTransport | null = null;
  private client: TerminalWorkerClient | null = null;
  private restartError: unknown;
  private disposed = false;
  private consecutiveCrashes = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private survivalTimer: ReturnType<typeof setTimeout> | null = null;

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
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.survivalTimer) {
      clearTimeout(this.survivalTimer);
      this.survivalTimer = null;
    }
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
    this.survivalTimer = setTimeout(() => {
      this.survivalTimer = null;
      this.consecutiveCrashes = 0;
    }, SURVIVAL_RESET_MS);
    this.survivalTimer.unref?.();
    client.onEvent((event) => {
      if (this.client !== client || this.disposed) return;
      for (const listener of this.eventSubscribers) listener(event);
    });
    client.onExit((code) => {
      if (this.client !== client || this.disposed) return;
      this.client = null;
      this.transport = null;
      if (this.survivalTimer) {
        clearTimeout(this.survivalTimer);
        this.survivalTimer = null;
      }
      this.consecutiveCrashes += 1;
      if (this.consecutiveCrashes > MAX_CONSECUTIVE_CRASHES) {
        this.restartError = new Error(
          `Terminal worker crashed ${MAX_CONSECUTIVE_CRASHES} times consecutively; giving up`,
        );
      } else {
        const delay = Math.min(BASE_BACKOFF_MS * 2 ** (this.consecutiveCrashes - 1), MAX_BACKOFF_MS);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          try {
            this.start();
          } catch (error) {
            this.restartError = error;
            console.error("Terminal worker restart failed", error);
          }
        }, delay);
        this.restartTimer.unref?.();
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
