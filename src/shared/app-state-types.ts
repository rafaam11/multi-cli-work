import type { TerminalKind, ToolCommand } from "./terminal-types";

export interface PersistedTerminalSession {
  id: string;
  /** Null for maintenance sessions, which run outside any folder. */
  projectId: string | null;
  tool: ToolCommand | null;
  /** What the provider calls this session; read from its transcript and refreshed as work moves on. */
  title: string | null;
  /** What the user calls this session. It wins over the provider's title. */
  name: string | null;
  kind: TerminalKind;
  cwd: string;
  /**
   * The worktree this session runs in, absent for sessions at the project root. The key is omitted
   * (not null) when absent, so a state file that never used worktrees still loads in older builds.
   */
  worktreeId?: string;
  providerConversationId: string | null;
  /**
   * True when this session shows as exited only because the app itself shut down (quit, update
   * restart) — not because the CLI ended. The next run auto-resumes such a session when it is first
   * viewed. Older state files omit the key, which reads as false.
   */
  interruptedByShutdown: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The workspace grid never shows more panes than this; extra sessions wait behind the +N menu. */
export const MAX_VISIBLE_SESSIONS = 6;

export interface AppStateV1 {
  schemaVersion: 1;
  updatedAt: string;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  /**
   * The sessions shown as workspace grid panes, in pane order (at most MAX_VISIBLE_SESSIONS).
   * Omitted (not null) while the grid is empty, so a state file that never used it keeps its exact
   * shape. Files from before the grid carry a single `splitSessionId` instead; parsing folds that
   * legacy key into this array.
   */
  visibleSessionIds?: string[];
  sessions: Record<string, PersistedTerminalSession>;
}

export interface AppStateSnapshot {
  state: AppStateV1;
  source: "primary" | "backup" | "empty";
  writable: boolean;
  warning?: string;
}

