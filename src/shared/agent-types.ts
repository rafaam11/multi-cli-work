/**
 * An agent is a CLI the app can run in a folder. The three the app ships with are described by the
 * same data as the ones a user adds in `agents.json`, so adding a CLI never means adding a branch.
 */
export type AgentId = string;

export const BUILTIN_AGENT_IDS = ["powershell", "claude", "codex"] as const;
export type BuiltinAgentId = (typeof BUILTIN_AGENT_IDS)[number];

/**
 * How the app learns what a session is doing.
 *
 * - `signals` — process liveness and terminal input only. The fallback every CLI supports, and the
 *   only one a user-defined agent gets by default. It cannot tell "thinking" from "waiting for you".
 * - `osc9` — the CLI emits OSC 9 desktop notifications, which the app reads off the PTY stream.
 *   A user-defined agent may pick this if its CLI emits them; the flags that turn them on belong in
 *   the agent's own `args`.
 * - `claude-hook` — Claude Code's hook protocol, driven by an app-owned settings overlay. Built-in
 *   only: it depends on `claude --settings` and on the app's own hook script.
 */
export type StatusAdapter = "signals" | "osc9" | "claude-hook";

/** Status adapters a user-defined agent may choose. `claude-hook` is not one of them. */
export const USER_STATUS_ADAPTERS = ["signals", "osc9"] as const satisfies readonly StatusAdapter[];

/**
 * Where a session's display title comes from. Each transcript format is its own parser, so this is
 * built-in only — a user-defined agent shows its own name until the user renames the session.
 */
export type TitleSource = "none" | "claude-transcript" | "codex-transcript";

/**
 * Who owns the id that lets a conversation be resumed after a restart.
 *
 * - `none` — the CLI has no conversation to resume. Resuming relaunches it.
 * - `app-generated` — the app mints the id and passes it in (Claude's `--session-id`).
 * - `provider-assigned` — the CLI mints its own id, which the app has to go and find afterwards.
 */
export type ConversationIdOwner = "none" | "app-generated" | "provider-assigned";

export interface AgentDefinition {
  id: AgentId;
  /** What the UI calls this agent. */
  label: string;
  /** Executable names to look for on PATH, in order. The first one found wins. */
  commands: string[];
  /** Arguments that always apply. They follow the new-session or resume arguments. */
  args: string[];
  /** Prepended when the session starts fresh. */
  newSessionArgs: string[];
  /** Prepended when the session resumes. */
  resumeArgs: string[];
  conversationId: ConversationIdOwner;
  statusAdapter: StatusAdapter;
  titleSource: TitleSource;
  /** Key of a built-in brand icon. Null falls back to a monogram tinted with `accentColor`. */
  icon: string | null;
  /** Hex colour for the monogram fallback. Built-ins leave this null and use their icon's own CSS. */
  accentColor: string | null;
  builtin: boolean;
}

/**
 * Placeholders an agent's arguments may contain. Anything else in braces is rejected when the
 * definition is loaded, so a typo in `agents.json` surfaces as an error instead of reaching a PTY.
 */
export const AGENT_ARG_TOKENS = ["cwd", "sessionId", "conversationId", "claudeSettings"] as const;
export type AgentArgToken = (typeof AGENT_ARG_TOKENS)[number];

export interface AgentRegistryV1 {
  schemaVersion: 1;
  updatedAt: string;
  agents: Record<AgentId, AgentDefinition>;
}

/** What the renderer gets: every known agent, and whether its executable is actually on PATH. */
export interface AgentView extends AgentDefinition {
  available: boolean;
}
