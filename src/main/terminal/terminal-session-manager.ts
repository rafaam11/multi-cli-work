import type {
  TerminalAttachment,
  TerminalLaunchSpec,
  TerminalSession,
  TerminalStatus,
  TerminalWorkerEvent,
} from "../../shared/terminal-types";

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

class OutputRingBuffer {
  private readonly chunks: string[] = [];
  private bytes = 0;

  constructor(private readonly maxBytes: number) {}

  append(data: string): void {
    let chunk = data;
    const chunkBytes = Buffer.byteLength(chunk);
    if (chunkBytes > this.maxBytes) {
      chunk = Buffer.from(chunk).subarray(chunkBytes - this.maxBytes).toString("utf8");
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
  pty: ManagedPty;
  output: OutputRingBuffer;
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly factory: ManagedPtyFactory,
    private readonly publish: (event: TerminalWorkerEvent) => void,
    private readonly maxReplayBytes = 5 * 1024 * 1024,
  ) {}

  create(spec: TerminalLaunchSpec): TerminalSession {
    if (this.sessions.has(spec.sessionId)) throw new Error(`Terminal session already exists: ${spec.sessionId}`);
    const pty = this.factory.spawn(spec.executable, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      cols: spec.cols,
      rows: spec.rows,
    });
    const session: TerminalSession = {
      id: spec.sessionId,
      projectId: spec.projectId,
      kind: spec.kind,
      cwd: spec.cwd,
      providerConversationId: spec.providerConversationId ?? null,
      status: "starting",
      pid: pty.pid,
      createdAt: spec.createdAt,
      updatedAt: spec.createdAt,
      exitCode: null,
    };
    const record: SessionRecord = { session, pty, output: new OutputRingBuffer(this.maxReplayBytes) };
    this.sessions.set(session.id, record);
    pty.onData((data) => {
      record.output.append(data);
      record.session.updatedAt = new Date().toISOString();
      this.publish({ type: "data", sessionId: session.id, data });
      if (record.session.status === "starting") this.setStatus(record, "idle");
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
    return { session: { ...record.session }, replay: record.output.toString() };
  }

  write(sessionId: string, data: string): void {
    this.requireSession(sessionId).pty.write(data);
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
}

