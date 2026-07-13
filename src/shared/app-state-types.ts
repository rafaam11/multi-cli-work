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
  createdAt: string;
  updatedAt: string;
}

export interface AppStateV1 {
  schemaVersion: 1;
  updatedAt: string;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  /**
   * The session shown in the secondary split pane. Omitted (not null) while nothing is split, so a
   * state file that never used the split keeps its exact shape and still loads in older builds.
   */
  splitSessionId?: string;
  sessions: Record<string, PersistedTerminalSession>;
}

export interface AppStateSnapshot {
  state: AppStateV1;
  source: "primary" | "backup" | "empty";
  writable: boolean;
  warning?: string;
}

