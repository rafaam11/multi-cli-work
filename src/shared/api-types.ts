import type { AgentView } from "./agent-types";
import type { AppStateSnapshot, PersistedTerminalSession } from "./app-state-types";
import type { FileExplorerTarget, FileTreeEntry, WorkspaceFileContent } from "./file-explorer-types";
import type { ProjectRegistrySnapshot, ProjectStatus, ProjectTrack, SharedProject } from "./project-types";
import type { TerminalEvent, TerminalKind, TerminalStatus, ToolCommand } from "./terminal-types";
import type { SharedWorktree, WorktreeRemovalResult } from "./worktree-types";

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

/** Uncommitted changes as one unified diff, for the read-only in-app diff view. */
export interface GitDiffResult {
  isRepo: boolean;
  /** `git diff HEAD` output, possibly cut at the size cap. */
  diff: string;
  /** Files git does not track yet — they never appear in the diff text. */
  untracked: string[];
  truncated: boolean;
}

/** VS Code is not an agent — it is the editor the folder menu opens — so it is tracked on its own. */
export interface ProviderAvailability {
  vscode: boolean;
}

/** What an off-screen session turned out to be waiting for. The key of every unread badge. */
export type SessionAttention = "input" | "approval";

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
  /** When set, the session runs in this worktree's directory instead of the project root. */
  worktreeId?: string;
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
    gitDiff(projectId: string): Promise<GitDiffResult>;
  };
  worktrees: {
    list(): Promise<SharedWorktree[]>;
    create(projectId: string, branch: string): Promise<SharedWorktree>;
    /** `force` discards uncommitted changes; the renderer must have shown the second confirmation. */
    remove(worktreeId: string, force: boolean): Promise<WorktreeRemovalResult>;
    reveal(worktreeId: string): Promise<void>;
    openInEditor(worktreeId: string): Promise<void>;
    gitStatus(worktreeId: string): Promise<GitStatusResult>;
    gitDiff(worktreeId: string): Promise<GitDiffResult>;
  };
  providers: {
    availability(): Promise<ProviderAvailability>;
  };
  agents: {
    list(): Promise<AgentsSnapshot>;
    /** Opens `agents.json` in the user's editor, writing a worked example first if it has none. */
    edit(): Promise<void>;
  };
  files: {
    /**
     * Absolute path of a file dragged in from the OS, or "" for a File with no backing path.
     * Synchronous — it never leaves the preload process.
     */
    pathFor(file: File): string;
  };
  workspaceFiles: {
    listDirectory(target: FileExplorerTarget, relativePath: string): Promise<FileTreeEntry[]>;
    readFile(target: FileExplorerTarget, relativePath: string): Promise<WorkspaceFileContent>;
    writeFile(target: FileExplorerTarget, relativePath: string, content: string): Promise<void>;
  };
  shell: {
    /** http(s) only — the main process rejects any other scheme. */
    openExternal(url: string): Promise<void>;
  };
  attention: {
    /** The sessions currently waiting for the user off screen, and what each waits for. */
    state(): Promise<Record<string, SessionAttention>>;
    onEvent(listener: (unread: Record<string, SessionAttention>) => void): () => void;
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
    /** Fills (or clears, with null) the secondary split pane. */
    split(sessionId: string | null): Promise<AppStateSnapshot>;
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
