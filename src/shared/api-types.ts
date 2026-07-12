import type { AppStateSnapshot, PersistedTerminalSession } from "./app-state-types";
import type { ProjectRegistrySnapshot, ProjectStatus, SharedProject } from "./project-types";
import type { TerminalKind, TerminalStatus, TerminalWorkerEvent } from "./terminal-types";

export interface ProjectMetadataPatch {
  displayName?: string | null;
  status?: ProjectStatus | null;
  memo?: string;
  hidden?: boolean;
  order?: number | null;
}

export interface ProviderAvailability {
  powershell: boolean;
  claude: boolean;
  codex: boolean;
}

export interface TerminalSessionView extends PersistedTerminalSession {
  status: TerminalStatus;
  pid: number | null;
  exitCode: number | null;
}

export interface CreateTerminalInput {
  projectId: string;
  kind: TerminalKind;
  cols: number;
  rows: number;
}

export interface ResumeTerminalInput {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface TerminalAttachResult {
  session: TerminalSessionView;
  replay: string;
  sequence: number;
}

export interface ProjectWorkspaceSnapshot extends ProjectRegistrySnapshot {
  missingRootProjectIds: string[];
}

export type UpdaterStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

export interface MultiCliWorkApi {
  platform: NodeJS.Platform;
  projects: {
    list(): Promise<ProjectWorkspaceSnapshot>;
    refresh(): Promise<ProjectWorkspaceSnapshot>;
    addFolder(): Promise<SharedProject | null>;
    update(projectId: string, patch: ProjectMetadataPatch): Promise<SharedProject>;
    relink(projectId: string): Promise<SharedProject | null>;
    restoreBackup(): Promise<ProjectWorkspaceSnapshot>;
  };
  providers: {
    availability(): Promise<ProviderAvailability>;
  };
  terminals: {
    list(): Promise<TerminalSessionView[]>;
    state(): Promise<AppStateSnapshot>;
    create(input: CreateTerminalInput): Promise<TerminalSessionView>;
    attach(sessionId: string): Promise<TerminalAttachResult>;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    stop(sessionId: string): Promise<void>;
    resume(input: ResumeTerminalInput): Promise<TerminalSessionView>;
    remove(sessionId: string): Promise<void>;
    select(projectId: string | null, sessionId: string | null): Promise<AppStateSnapshot>;
    onEvent(listener: (event: TerminalWorkerEvent) => void): () => void;
  };
  updates: {
    appVersion(): Promise<string>;
    status(): Promise<UpdaterStatus>;
    check(): Promise<void>;
    install(): Promise<void>;
    openReleases(): Promise<void>;
    onEvent(listener: (status: UpdaterStatus) => void): () => void;
  };
}
