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

/**
 * One page of the workspace grid never shows more panes than this — no layout has more slots.
 * The cap lives here because it guards the `terminals:set-visible-sessions` contract in main,
 * which cannot see the renderer's layout catalog.
 */
export const MAX_VISIBLE_SESSIONS = 6;

/** How many workspaces the sidebar offers. Fixed at three; naming and resizing them are later work. */
export const WORKSPACE_COUNT = 3;

/**
 * One grid's arrangement: the layout preset it uses, and which session sits in each slot.
 * `slots` may run longer than the layout has slots — the overflow is the next page. A `null` is a
 * slot deliberately left empty, which the UI keeps as a drop target rather than closing up.
 */
export interface SlotViewState {
  layoutId: string;
  slots: (string | null)[];
}

export interface AppStateV1 {
  schemaVersion: 1;
  updatedAt: string;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  /**
   * The sessions on screen right now, in pane order (at most MAX_VISIBLE_SESSIONS). This is what
   * main reads to decide whether a session's event deserves a notification, so it tracks the
   * current page rather than the saved arrangement. Omitted (not null) while nothing is on screen,
   * so a state file that never used it keeps its exact shape. Files from before the grid carry a
   * single `splitSessionId` instead; parsing folds that legacy key into this array.
   */
  visibleSessionIds?: string[];
  /** Each folder's saved grid, keyed by project id. Omitted while no folder has one. */
  folderViews?: Record<string, SlotViewState>;
  /** The curated workspaces, in sidebar order (at most WORKSPACE_COUNT). Omitted while unused. */
  workspaces?: SlotViewState[];
  sessions: Record<string, PersistedTerminalSession>;
}

export interface AppStateSnapshot {
  state: AppStateV1;
  source: "primary" | "backup" | "empty";
  writable: boolean;
  warning?: string;
}

