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
}

export interface MultiCliWorkApi {
  platform: NodeJS.Platform;
  projects: {
    list(): Promise<ProjectRegistrySnapshot>;
    refresh(): Promise<ProjectRegistrySnapshot>;
    addFolder(): Promise<SharedProject | null>;
    update(projectId: string, patch: ProjectMetadataPatch): Promise<SharedProject>;
    relink(projectId: string): Promise<SharedProject | null>;
  };
  providers: {
    availability(): Promise<ProviderAvailability>;
  };
  terminals: {
    list(): Promise<TerminalSessionView[]>;
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
}

