import type { AppStateV1, PersistedTerminalSession } from "../../shared/app-state-types";
import type {
  CreateTerminalInput,
  CreateToolTerminalInput,
  ResumeTerminalInput,
  TerminalAttachResult,
  TerminalSessionView,
} from "../../shared/api-types";
import type { SharedProject } from "../../shared/project-types";
import type {
  TerminalAttachment,
  TerminalLaunchSpec,
  TerminalSession,
  TerminalStatus,
  TerminalWorkerEvent,
  ToolCommand,
} from "../../shared/terminal-types";
import { buildProviderLaunch, buildToolLaunch, type ProviderExecutables } from "../providers/provider-launch";
import { cleanupProviderStatusFiles, deleteProviderStatusFile } from "../providers/provider-status";
import {
  appendSessionLog,
  deleteSessionLog,
  readAppState,
  readSessionLog,
  updateAppState,
} from "../state/app-state";

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const LOG_TRIM_SLACK_BYTES = 256 * 1024;
const DEFAULT_LOG_FLUSH_MS = 100;

export interface TerminalWorkerGateway {
  create(spec: TerminalLaunchSpec): Promise<TerminalSession>;
  attach(sessionId: string): Promise<TerminalAttachment>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  stop(sessionId: string): Promise<void>;
  onEvent(listener: (event: TerminalWorkerEvent) => void): () => void;
  onExit(listener: (code: number) => void): () => void;
}

interface TerminalCoordinatorOptions {
  worker: TerminalWorkerGateway;
  statePath: string;
  logDir: string;
  statusDir?: string;
  claudeSettingsPath: string;
  getProject(projectId: string): Promise<SharedProject | null>;
  getExecutables(): Promise<ProviderExecutables>;
  toolSessionCwd(): string;
  env: Record<string, string>;
  idFactory(): string;
  now(): string;
  codexSessions?: {
    snapshot(cwd: string): Promise<ReadonlySet<string>>;
    waitForNew(cwd: string, knownIds: ReadonlySet<string>, signal?: AbortSignal): Promise<string | null>;
  };
  appendLog?: typeof appendSessionLog;
  logFlushMs?: number;
}

function persistedSession(view: TerminalSessionView): PersistedTerminalSession {
  return {
    id: view.id,
    projectId: view.projectId,
    tool: view.tool,
    kind: view.kind,
    cwd: view.cwd,
    providerConversationId: view.providerConversationId,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
  };
}

function runningView(session: TerminalSession): TerminalSessionView {
  return { ...session };
}

function exitedView(session: PersistedTerminalSession): TerminalSessionView {
  return { ...session, status: "exited", pid: null, exitCode: null };
}

export class TerminalCoordinator {
  private readonly views = new Map<string, TerminalSessionView>();
  private readonly subscribers = new Set<(event: TerminalWorkerEvent) => void>();
  private readonly backgroundTasks = new Set<Promise<void>>();
  private readonly pendingLogChunks = new Map<string, string[]>();
  private readonly logFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly logWrites = new Map<string, Promise<void>>();
  private readonly removedSessionIds = new Set<string>();
  private readonly codexCorrelationAbort = new AbortController();
  private eventChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: TerminalCoordinatorOptions) {
    options.worker.onEvent((event) => {
      if (event.type === "data") this.handleDataEvent(event);
      else this.enqueueEvent(() => this.handleWorkerEvent(event));
    });
    options.worker.onExit((code) => {
      this.enqueueEvent(() => this.handleWorkerExit(code));
    });
  }

  async initialize(): Promise<void> {
    const snapshot = await readAppState({ statePath: this.options.statePath });
    for (const session of Object.values(snapshot.state.sessions)) this.views.set(session.id, exitedView(session));
    if (this.options.statusDir) {
      await cleanupProviderStatusFiles(this.options.statusDir, new Set(this.views.keys())).catch((error) =>
        this.reportAsyncError("Provider status cleanup failed", error),
      );
    }
  }

  list(): TerminalSessionView[] {
    return [...this.views.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  state() {
    return readAppState({ statePath: this.options.statePath });
  }

  async create(input: CreateTerminalInput): Promise<TerminalSessionView> {
    this.validateDimensions(input.cols, input.rows);
    const project = await this.options.getProject(input.projectId);
    if (!project) throw new Error(`Unknown project: ${input.projectId}`);
    return this.launch({
      sessionId: this.options.idFactory(),
      projectId: project.id,
      tool: null,
      cwd: project.rootPath,
      kind: input.kind,
      cols: input.cols,
      rows: input.rows,
      createdAt: this.options.now(),
      resumeConversationId: null,
    });
  }

  /** Maintenance sessions run a fixed CLI command in the home directory and belong to no folder. */
  async createTool(input: CreateToolTerminalInput): Promise<TerminalSessionView> {
    this.validateDimensions(input.cols, input.rows);
    return this.launch({
      sessionId: this.options.idFactory(),
      projectId: null,
      tool: input.tool,
      cwd: this.options.toolSessionCwd(),
      kind: "powershell",
      cols: input.cols,
      rows: input.rows,
      createdAt: this.options.now(),
      resumeConversationId: null,
    });
  }

  async resume(input: ResumeTerminalInput): Promise<TerminalSessionView> {
    this.validateDimensions(input.cols, input.rows);
    const saved = this.views.get(input.sessionId);
    if (!saved) throw new Error(`Unknown terminal session: ${input.sessionId}`);
    if (saved.kind !== "powershell" && !saved.providerConversationId) {
      throw new Error(`${saved.kind} session does not have a resumable conversation id`);
    }
    // Folder sessions re-read the project so a relinked folder resumes at its new root.
    // Maintenance sessions have no project, so their recorded cwd is authoritative.
    let cwd = saved.cwd;
    if (saved.projectId !== null) {
      const project = await this.options.getProject(saved.projectId);
      if (!project) throw new Error(`Unknown project: ${saved.projectId}`);
      cwd = project.rootPath;
    }
    return this.launch({
      sessionId: saved.id,
      projectId: saved.projectId,
      tool: saved.tool,
      cwd,
      kind: saved.kind,
      cols: input.cols,
      rows: input.rows,
      createdAt: saved.createdAt,
      resumeConversationId: saved.providerConversationId,
    });
  }

  async attach(sessionId: string): Promise<TerminalAttachResult> {
    const view = this.views.get(sessionId);
    if (!view) throw new Error(`Unknown terminal session: ${sessionId}`);
    if (view.pid !== null && view.status !== "exited" && view.status !== "error") {
      try {
        const attachment = await this.options.worker.attach(sessionId);
        return { session: runningView(attachment.session), replay: attachment.replay, sequence: attachment.sequence };
      } catch {
        // The worker may have exited between list and attach; the persisted log is still usable.
      }
    }
    return {
      session: { ...view, status: "exited", pid: null },
      replay: await readSessionLog(this.options.logDir, sessionId, MAX_LOG_BYTES),
      sequence: 0,
    };
  }

  write(sessionId: string, data: string): Promise<void> {
    return this.options.worker.write(sessionId, data);
  }

  resize(sessionId: string, cols: number, rows: number): Promise<void> {
    this.validateDimensions(cols, rows);
    const view = this.views.get(sessionId);
    if (!view) throw new Error(`Unknown terminal session: ${sessionId}`);
    if (view.pid === null || view.status === "exited" || view.status === "error") return Promise.resolve();
    return this.options.worker.resize(sessionId, cols, rows);
  }

  stop(sessionId: string): Promise<void> {
    if (!this.views.has(sessionId)) throw new Error(`Unknown terminal session: ${sessionId}`);
    return this.options.worker.stop(sessionId);
  }

  async remove(sessionId: string): Promise<void> {
    const view = this.views.get(sessionId);
    if (!view) return;
    this.removedSessionIds.add(sessionId);
    this.views.delete(sessionId);
    this.dropPendingLog(sessionId);
    if (view.pid !== null && view.status !== "exited") await this.options.worker.stop(sessionId).catch(() => undefined);
    await this.logWrites.get(sessionId)?.catch(() => undefined);
    await updateAppState(
      (state) => {
        const sessions = { ...state.sessions };
        delete sessions[sessionId];
        return { ...state, sessions, selectedSessionId: state.selectedSessionId === sessionId ? null : state.selectedSessionId };
      },
      { statePath: this.options.statePath },
    );
    await deleteSessionLog(this.options.logDir, sessionId);
    if (this.options.statusDir) {
      await deleteProviderStatusFile(this.options.statusDir, sessionId);
    }
  }

  /**
   * Tears down every session of a folder before the folder itself is unregistered. Each session is
   * removed best-effort so one failure cannot strand the rest; the caller only deletes the project
   * from the registry once this resolves, so a partial failure leaves the folder reachable to retry.
   */
  async removeProjectSessions(projectId: string): Promise<void> {
    const sessions = this.list().filter((session) => session.projectId === projectId);
    const failures: unknown[] = [];
    for (const session of sessions) {
      try {
        await this.remove(session.id);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new Error(`Failed to remove ${failures.length} of ${sessions.length} sessions`, { cause: failures[0] });
    }
  }

  async select(projectId: string | null, sessionId: string | null) {
    const state = await updateAppState(
      (current) => ({ ...current, selectedProjectId: projectId, selectedSessionId: sessionId }),
      { statePath: this.options.statePath },
    );
    return { state, source: "primary" as const, writable: true };
  }

  onEvent(listener: (event: TerminalWorkerEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  applyProviderStatus(sessionId: string, status: TerminalStatus): void {
    const view = this.views.get(sessionId);
    if (
      !view ||
      view.kind !== "claude" ||
      view.pid === null ||
      status === "exited" ||
      status === "error" ||
      view.status === "exited" ||
      view.status === "error"
    ) return;
    this.enqueueEvent(() => this.handleWorkerEvent({ type: "status", sessionId, status }));
  }

  async flush(includeBackgroundTasks = true): Promise<void> {
    await this.eventChain;
    await this.flushPendingLogs();
    if (includeBackgroundTasks) await Promise.all([...this.backgroundTasks]);
    await this.eventChain;
    await this.flushPendingLogs();
  }

  hasActiveSessions(): boolean {
    return this.list().some((session) => session.pid !== null && session.status !== "exited" && session.status !== "error");
  }

  async shutdown(): Promise<void> {
    this.codexCorrelationAbort.abort();
    const active = this.list().filter(
      (session) => session.pid !== null && session.status !== "exited" && session.status !== "error",
    );
    await Promise.all(active.map((session) => this.options.worker.stop(session.id).catch(() => undefined)));
    await this.flush(false);
  }

  private async launch(input: {
    sessionId: string;
    projectId: string | null;
    tool: ToolCommand | null;
    cwd: string;
    kind: TerminalSessionView["kind"];
    cols: number;
    rows: number;
    createdAt: string;
    resumeConversationId: string | null;
  }): Promise<TerminalSessionView> {
    const knownCodexIds =
      input.kind === "codex" && !input.resumeConversationId && this.options.codexSessions
        ? await this.options.codexSessions.snapshot(input.cwd).catch(() => new Set<string>())
        : null;
    const executables = await this.options.getExecutables();
    const command = input.tool
      ? buildToolLaunch(input.tool, executables)
      : buildProviderLaunch(input.kind, {
          cwd: input.cwd,
          appSessionId: input.sessionId,
          claudeSettingsPath: this.options.claudeSettingsPath,
          executables,
          resumeConversationId: input.resumeConversationId,
        });
    const session = await this.options.worker.create({
      sessionId: input.sessionId,
      projectId: input.projectId,
      tool: input.tool,
      kind: input.kind,
      cwd: input.cwd,
      executable: command.executable,
      args: command.args,
      env: { ...this.options.env, MULTI_CLI_WORK_SESSION_ID: input.sessionId },
      cols: input.cols,
      rows: input.rows,
      createdAt: input.createdAt,
      providerConversationId: command.providerConversationId,
    });
    const view = runningView(session);
    this.views.set(view.id, view);
    await this.persistView(view, (state) => ({
      ...state,
      selectedProjectId: view.projectId,
      selectedSessionId: view.id,
    }));
    if (knownCodexIds && this.options.codexSessions) {
      this.correlateCodexConversation(view.id, view.cwd, knownCodexIds);
    }
    return { ...view };
  }

  private correlateCodexConversation(sessionId: string, cwd: string, knownIds: ReadonlySet<string>): void {
    const tracker = this.options.codexSessions;
    if (!tracker) return;
    const task = tracker
      .waitForNew(cwd, knownIds, this.codexCorrelationAbort.signal)
      .then(async (conversationId) => {
        if (!conversationId) return;
        const view = this.views.get(sessionId);
        if (!view || view.kind !== "codex" || view.providerConversationId) return;
        view.providerConversationId = conversationId;
        view.updatedAt = this.options.now();
        await this.persistView(view);
      })
      .catch((error) => {
        console.error("Codex session correlation failed", error);
      });
    this.backgroundTasks.add(task);
    void task.finally(() => this.backgroundTasks.delete(task));
  }

  private async persistView(view: TerminalSessionView, transform: (state: AppStateV1) => AppStateV1 = (state) => state) {
    await updateAppState(
      (state) => {
        const next = transform(state);
        return { ...next, sessions: { ...next.sessions, [view.id]: persistedSession(view) } };
      },
      { statePath: this.options.statePath },
    );
  }

  private async handleWorkerEvent(event: TerminalWorkerEvent): Promise<void> {
    const view = this.views.get(event.sessionId);
    if (view && event.type === "status") {
      if (view.status === event.status) return;
      view.status = event.status;
      view.updatedAt = this.options.now();
      await this.persistView(view);
    } else if (view && event.type === "exit") {
      view.status = "exited";
      view.exitCode = event.exitCode;
      view.pid = null;
      view.updatedAt = this.options.now();
      await this.persistView(view);
    }
    this.publish(event);
  }

  private async handleWorkerExit(_code: number): Promise<void> {
    const active = this.list().filter(
      (view) => view.pid !== null && view.status !== "exited" && view.status !== "error",
    );
    for (const view of active) {
      view.status = "error";
      view.pid = null;
      view.exitCode = null;
      view.updatedAt = this.options.now();
      await this.persistView(view);
      const event: TerminalWorkerEvent = { type: "status", sessionId: view.id, status: "error" };
      this.publish(event);
    }
  }

  private handleDataEvent(event: Extract<TerminalWorkerEvent, { type: "data" }>): void {
    if (this.removedSessionIds.has(event.sessionId)) return;
    this.publish(event);
    const chunks = this.pendingLogChunks.get(event.sessionId) ?? [];
    chunks.push(event.data);
    this.pendingLogChunks.set(event.sessionId, chunks);
    if (this.logFlushTimers.has(event.sessionId)) return;
    const timer = setTimeout(() => {
      this.logFlushTimers.delete(event.sessionId);
      void this.flushSessionLog(event.sessionId);
    }, this.options.logFlushMs ?? DEFAULT_LOG_FLUSH_MS);
    timer.unref?.();
    this.logFlushTimers.set(event.sessionId, timer);
  }

  private async flushPendingLogs(): Promise<void> {
    for (const timer of this.logFlushTimers.values()) clearTimeout(timer);
    this.logFlushTimers.clear();
    while (this.pendingLogChunks.size > 0) {
      await Promise.all([...this.pendingLogChunks.keys()].map((sessionId) => this.flushSessionLog(sessionId)));
    }
    await Promise.all([...this.logWrites.values()]);
  }

  private async flushSessionLog(sessionId: string): Promise<void> {
    const chunks = this.pendingLogChunks.get(sessionId);
    if (!chunks || chunks.length === 0) return;
    this.pendingLogChunks.delete(sessionId);
    const previous = this.logWrites.get(sessionId) ?? Promise.resolve();
    const appendLog = this.options.appendLog ?? appendSessionLog;
    const write = previous
      .catch((error) => this.reportAsyncError("Previous terminal log write failed", error))
      .then(() =>
        appendLog(
          this.options.logDir,
          sessionId,
          chunks.join(""),
          MAX_LOG_BYTES,
          LOG_TRIM_SLACK_BYTES,
        ),
      )
      .catch((error) => this.reportAsyncError("Terminal log write failed", error));
    this.logWrites.set(sessionId, write);
    await write;
    if (this.logWrites.get(sessionId) === write) this.logWrites.delete(sessionId);
  }

  private dropPendingLog(sessionId: string): void {
    const timer = this.logFlushTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.logFlushTimers.delete(sessionId);
    this.pendingLogChunks.delete(sessionId);
  }

  private enqueueEvent(task: () => Promise<void>): void {
    this.eventChain = this.eventChain
      .catch((error) => this.reportAsyncError("Terminal event failed", error))
      .then(task)
      .catch((error) => this.reportAsyncError("Terminal event failed", error));
  }

  private publish(event: TerminalWorkerEvent): void {
    for (const listener of this.subscribers) {
      try {
        listener(event);
      } catch (error) {
        this.reportAsyncError("Terminal event subscriber failed", error);
      }
    }
  }

  private reportAsyncError(message: string, error: unknown): void {
    console.error(message, error);
  }

  private validateDimensions(cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1 || cols > 1_000 || rows > 500) {
      throw new Error("Terminal dimensions are invalid");
    }
  }
}
