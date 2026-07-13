import type { StatusAdapter } from "../../shared/agent-types";
import type {
  TerminalAttachment,
  TerminalLaunchSpec,
  TerminalSession,
  TerminalStatus,
  TerminalWorkerEvent,
} from "../../shared/terminal-types";
import { tailOnUtf8Boundary } from "../utf8";

export interface ManagedPty {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
}

interface PtySpawnOptions {
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export interface ManagedPtyFactory {
  spawn(executable: string, args: string[], options: PtySpawnOptions): ManagedPty;
}

export class OutputRingBuffer {
  private readonly chunks: string[] = [];
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  append(data: string): void {
    let chunk = data;
    const chunkBytes = Buffer.byteLength(chunk);
    if (chunkBytes > this.maxBytes) {
      chunk = tailOnUtf8Boundary(Buffer.from(chunk), this.maxBytes).toString("utf8");
      this.chunks.length = 0;
      this.bytes = 0;
    }
    this.chunks.push(chunk);
    this.bytes += Buffer.byteLength(chunk);
    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      this.bytes -= Buffer.byteLength(this.chunks.shift()!);
    }
  }

  toString(): string {
    return this.chunks.join("");
  }
}

interface SessionRecord {
  session: TerminalSession;
  statusAdapter: StatusAdapter;
  pty: ManagedPty;
  output: OutputRingBuffer;
  controlBuffer: string;
  outputSequence: number;
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly factory: ManagedPtyFactory,
    private readonly publish: (event: TerminalWorkerEvent) => void,
    private readonly maxReplayBytes = 5 * 1024 * 1024,
  ) {}

  create(spec: TerminalLaunchSpec): TerminalSession {
    const existing = this.sessions.get(spec.sessionId);
    if (existing?.session.status === "exited") this.sessions.delete(spec.sessionId);
    else if (existing) throw new Error(`Terminal session already exists: ${spec.sessionId}`);
    const pty = this.factory.spawn(spec.executable, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      cols: spec.cols,
      rows: spec.rows,
    });
    const session: TerminalSession = {
      id: spec.sessionId,
      projectId: spec.projectId,
      tool: spec.tool,
      kind: spec.kind,
      cwd: spec.cwd,
      providerConversationId: spec.providerConversationId ?? null,
      status: "starting",
      pid: pty.pid,
      createdAt: spec.createdAt,
      updatedAt: spec.createdAt,
      exitCode: null,
    };
    const record: SessionRecord = {
      session,
      statusAdapter: spec.statusAdapter,
      pty,
      output: new OutputRingBuffer(this.maxReplayBytes),
      controlBuffer: "",
      outputSequence: 0,
    };
    this.sessions.set(session.id, record);
    pty.onData((data) => {
      record.outputSequence += 1;
      record.output.append(data);
      record.session.updatedAt = new Date().toISOString();
      this.publish({ type: "data", sessionId: session.id, data, sequence: record.outputSequence });
      if (record.session.status === "starting") this.setStatus(record, "idle");
      if (record.statusAdapter === "osc9") this.applyOsc9Notifications(record, data);
    });
    pty.onExit(({ exitCode, signal }) => {
      record.session.exitCode = exitCode;
      record.session.updatedAt = new Date().toISOString();
      this.setStatus(record, "exited");
      this.publish({ type: "exit", sessionId: session.id, exitCode, signal });
    });
    this.publish({ type: "status", sessionId: session.id, status: "starting" });
    return { ...session };
  }

  attach(sessionId: string): TerminalAttachment {
    const record = this.requireSession(sessionId);
    return { session: { ...record.session }, replay: record.output.toString(), sequence: record.outputSequence };
  }

  write(sessionId: string, data: string): void {
    const record = this.requireSession(sessionId);
    record.pty.write(data);
    // Submitting a prompt means the agent is now working — but only say so for an agent that has a
    // way back out. A `signals` agent reports nothing of its own, so marking it working would strand
    // it there; it stays idle, which is the honest answer when we cannot tell.
    if (record.statusAdapter !== "signals" && /[\r\n]/.test(data)) this.setStatus(record, "working");
  }

  resize(sessionId: string, cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1) {
      throw new Error("Terminal dimensions are invalid");
    }
    this.requireSession(sessionId).pty.resize(cols, rows);
  }

  stop(sessionId: string): void {
    const record = this.requireSession(sessionId);
    if (record.session.status !== "exited") record.pty.kill();
  }

  private requireSession(sessionId: string): SessionRecord {
    const record = this.sessions.get(sessionId);
    if (!record) throw new Error(`Unknown terminal session: ${sessionId}`);
    return record;
  }

  private setStatus(record: SessionRecord, status: TerminalStatus): void {
    if (record.session.status === status) return;
    record.session.status = status;
    record.session.updatedAt = new Date().toISOString();
    this.publish({ type: "status", sessionId: record.session.id, status });
  }

  /**
   * OSC 9 is a desktop-notification escape sequence. Codex is configured to emit one when a turn
   * ends or an approval is wanted; any agent whose CLI emits them can opt in the same way.
   */
  private applyOsc9Notifications(record: SessionRecord, data: string): void {
    record.controlBuffer = `${record.controlBuffer}${data}`.slice(-2_048);
    const notificationPattern = /\u001b\]9;([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;
    let match: RegExpExecArray | null;
    let consumed = 0;
    while ((match = notificationPattern.exec(record.controlBuffer)) !== null) {
      consumed = notificationPattern.lastIndex;
      const message = match[1].trim().toLocaleLowerCase("en-US");
      if (message.includes("approval-requested") || message.includes("approval requested")) {
        this.setStatus(record, "awaiting-approval");
      } else if (message) {
        this.setStatus(record, "awaiting-input");
      }
    }
    if (consumed > 0) record.controlBuffer = record.controlBuffer.slice(consumed);
  }
}
