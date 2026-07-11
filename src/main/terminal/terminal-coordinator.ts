import type { AppStateV1, PersistedTerminalSession } from "../../shared/app-state-types";
import type {
  CreateTerminalInput,
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
} from "../../shared/terminal-types";
import { buildProviderLaunch, type ProviderExecutables } from "../providers/provider-launch";
import {
  appendSessionLog,
  deleteSessionLog,
  readAppState,
  readSessionLog,
  updateAppState,
} from "../state/app-state";

const MAX_LOG_BYTES = 5 * 1024 * 1024;

export interface TerminalWorkerGateway {
  create(spec: TerminalLaunchSpec): Promise<TerminalSession>;
  attach(sessionId: string): Promise<TerminalAttachment>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  stop(sessionId: string): Promise<void>;
  onEvent(listener: (event: TerminalWorkerEvent) => void): () => void;
}

interface TerminalCoordinatorOptions {
  worker: TerminalWorkerGateway;
  statePath: string;
  logDir: string;
  claudeSettingsPath: string;
  getProject(projectId: string): Promise<SharedProject | null>;
  getExecutables(): Promise<ProviderExecutables>;
  env: Record<string, string>;
  idFactory(): string;
  now(): string;
}

function persistedSession(view: TerminalSessionView): PersistedTerminalSession {
  return {
    id: view.id,
    projectId: view.projectId,
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
  private eventChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: TerminalCoordinatorOptions) {
    options.worker.onEvent((event) => {
      this.eventChain = this.eventChain.then(() => this.handleWorkerEvent(event));
    });
  }

  async initialize(): Promise<void> {
    const snapshot = await readAppState({ statePath: this.options.statePath });
    for (const session of Object.values(snapshot.state.sessions)) this.views.set(session.id, exitedView(session));
  }

  list(): TerminalSessionView[] {
    return [...this.views.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async create(input: CreateTerminalInput): Promise<TerminalSessionView> {
    this.validateDimensions(input.cols, input.rows);
    const project = await this.options.getProject(input.projectId);
    if (!project) throw new Error(`Unknown project: ${input.projectId}`);
    const sessionId = this.options.idFactory();
    return this.launch({
      sessionId,
      project,
      kind: input.kind,
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
    const project = await this.options.getProject(saved.projectId);
    if (!project) throw new Error(`Unknown project: ${saved.projectId}`);
    return this.launch({
      sessionId: saved.id,
      project,
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
        return { session: runningView(attachment.session), replay: attachment.replay };
      } catch {
        // The worker may have exited between list and attach; the persisted log is still usable.
      }
    }
    return {
      session: { ...view, status: "exited", pid: null },
      replay: await readSessionLog(this.options.logDir, sessionId, MAX_LOG_BYTES),
    };
  }

  write(sessionId: string, data: string): Promise<void> {
    return this.options.worker.write(sessionId, data);
  }

  resize(sessionId: string, cols: number, rows: number): Promise<void> {
    this.validateDimensions(cols, rows);
    return this.options.worker.resize(sessionId, cols, rows);
  }

  stop(sessionId: string): Promise<void> {
    if (!this.views.has(sessionId)) throw new Error(`Unknown terminal session: ${sessionId}`);
    return this.options.worker.stop(sessionId);
  }

  async remove(sessionId: string): Promise<void> {
    const view = this.views.get(sessionId);
    if (!view) return;
    if (view.pid !== null && view.status !== "exited") await this.options.worker.stop(sessionId).catch(() => undefined);
    this.views.delete(sessionId);
    await updateAppState(
      (state) => {
        const sessions = { ...state.sessions };
        delete sessions[sessionId];
        return { ...state, sessions, selectedSessionId: state.selectedSessionId === sessionId ? null : state.selectedSessionId };
      },
      { statePath: this.options.statePath },
    );
    await deleteSessionLog(this.options.logDir, sessionId);
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
    this.eventChain = this.eventChain.then(() =>
      this.handleWorkerEvent({ type: "status", sessionId, status }),
    );
  }

  async flush(): Promise<void> {
    await this.eventChain;
  }

  hasActiveSessions(): boolean {
    return this.list().some((session) => session.pid !== null && session.status !== "exited" && session.status !== "error");
  }

  async shutdown(): Promise<void> {
    const active = this.list().filter(
      (session) => session.pid !== null && session.status !== "exited" && session.status !== "error",
    );
    await Promise.all(active.map((session) => this.options.worker.stop(session.id).catch(() => undefined)));
    await this.flush();
  }

  private async launch(input: {
    sessionId: string;
    project: SharedProject;
    kind: TerminalSessionView["kind"];
    cols: number;
    rows: number;
    createdAt: string;
    resumeConversationId: string | null;
  }): Promise<TerminalSessionView> {
    const executables = await this.options.getExecutables();
    const command = buildProviderLaunch(input.kind, {
      cwd: input.project.rootPath,
      appSessionId: input.sessionId,
      claudeSettingsPath: this.options.claudeSettingsPath,
      executables,
      resumeConversationId: input.resumeConversationId,
    });
    const session = await this.options.worker.create({
      sessionId: input.sessionId,
      projectId: input.project.id,
      kind: input.kind,
      cwd: input.project.rootPath,
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
    return { ...view };
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
    if (event.type === "data") {
      await appendSessionLog(this.options.logDir, event.sessionId, event.data, MAX_LOG_BYTES);
    } else if (view && event.type === "status") {
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
    this.subscribers.forEach((listener) => listener(event));
  }

  private validateDimensions(cols: number, rows: number): void {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1 || cols > 1_000 || rows > 500) {
      throw new Error("Terminal dimensions are invalid");
    }
  }
}
