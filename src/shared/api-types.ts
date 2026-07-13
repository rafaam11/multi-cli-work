import type { AgentView } from "./agent-types";
import type { AppStateSnapshot, PersistedTerminalSession } from "./app-state-types";
import type { ProjectRegistrySnapshot, ProjectStatus, ProjectTrack, SharedProject } from "./project-types";
import type { TerminalEvent, TerminalKind, TerminalStatus, ToolCommand } from "./terminal-types";

export interface ProjectMetadataPatch {
  displayName?: string | null;
  status?: ProjectStatus | null;
  memo?: string;
  tracks?: ProjectTrack[];
  hidden?: boolean;
  order?: number | null;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string | null;
  changedFileCount: number;
}

/** VS Code is not an agent — it is the editor the folder menu opens — so it is tracked on its own. */
export interface ProviderAvailability {
  vscode: boolean;
}

/**
 * Every agent the app knows, in launcher order, each already told whether its executable is on PATH.
 * This replaces the renderer's old hard-coded provider table.
 */
export interface AgentsSnapshot {
  agents: AgentView[];
  /** Why the user's `agents.json` was ignored, when it was. */
  warning?: string;
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

export interface CreateToolTerminalInput {
  tool: ToolCommand;
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
    addFolder(): Promise<SharedProject | null>;
    update(projectId: string, patch: ProjectMetadataPatch): Promise<SharedProject>;
    remove(projectId: string): Promise<ProjectWorkspaceSnapshot>;
    relink(projectId: string): Promise<SharedProject | null>;
    restoreBackup(): Promise<ProjectWorkspaceSnapshot>;
    reveal(projectId: string): Promise<void>;
    openInEditor(projectId: string): Promise<void>;
    openOnGitHub(projectId: string): Promise<void>;
    gitStatus(projectId: string): Promise<GitStatusResult>;
  };
  providers: {
    availability(): Promise<ProviderAvailability>;
  };
  agents: {
    list(): Promise<AgentsSnapshot>;
    /** Opens `agents.json` in the user's editor, writing a worked example first if it has none. */
    edit(): Promise<void>;
  };
  terminals: {
    list(): Promise<TerminalSessionView[]>;
    state(): Promise<AppStateSnapshot>;
    create(input: CreateTerminalInput): Promise<TerminalSessionView>;
    createTool(input: CreateToolTerminalInput): Promise<TerminalSessionView>;
    attach(sessionId: string): Promise<TerminalAttachResult>;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    stop(sessionId: string): Promise<void>;
    resume(input: ResumeTerminalInput): Promise<TerminalSessionView>;
    remove(sessionId: string): Promise<void>;
    rename(sessionId: string, name: string | null): Promise<TerminalSessionView>;
    select(projectId: string | null, sessionId: string | null): Promise<AppStateSnapshot>;
    onEvent(listener: (event: TerminalEvent) => void): () => void;
  };
  updates: {
    appVersion(): Promise<string>;
    status(): Promise<UpdaterStatus>;
    check(): Promise<void>;
    install(): Promise<void>;
    openReleases(): Promise<void>;
    openRepository(): Promise<void>;
    onEvent(listener: (status: UpdaterStatus) => void): () => void;
  };
}
