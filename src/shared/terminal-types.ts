import type { AgentId, StatusAdapter } from "./agent-types";
import type { TerminalSessionView } from "./api-types";

/**
 * Which agent a session runs. Sessions record the agent's id rather than a closed union, so a CLI
 * the user adds in `agents.json` is a first-class session and an agent they later remove leaves its
 * sessions readable instead of taking the whole state file down with it.
 */
export type TerminalKind = AgentId;
/** Maintenance commands that run in a session which belongs to no folder. */
export type ToolCommand = "claude-update" | "codex-update";
export type TerminalStatus =
  | "starting"
  | "working"
  | "awaiting-input"
  | "awaiting-approval"
  | "idle"
  | "exited"
  | "error";

export interface TerminalSession {
  id: string;
  projectId: string | null;
  tool: ToolCommand | null;
  kind: TerminalKind;
  cwd: string;
  providerConversationId: string | null;
  status: TerminalStatus;
  pid: number;
  createdAt: string;
  updatedAt: string;
  exitCode: number | null;
}

export interface TerminalLaunchSpec {
  sessionId: string;
  projectId: string | null;
  tool: ToolCommand | null;
  kind: TerminalKind;
  /** How the PTY worker should read this session's status off its own output. */
  statusAdapter: StatusAdapter;
  cwd: string;
  executable: string;
  args: string[];
  env: Record<string, string>;
  cols: number;
  rows: number;
  createdAt: string;
  providerConversationId?: string | null;
}

export interface TerminalAttachment {
  session: TerminalSession;
  replay: string;
  sequence: number;
}

export type TerminalWorkerEvent =
  | { type: "data"; sessionId: string; data: string; sequence: number }
  | { type: "status"; sessionId: string; status: TerminalStatus }
  | { type: "exit"; sessionId: string; exitCode: number; signal?: number };

/**
 * What the renderer subscribes to. The PTY worker only knows about the events above; the title is
 * read from the provider's transcript, and `created` announces sessions the renderer did not start
 * itself (a lazy auto-resume in the split pane, a jk-coding-cli spawn) so its list stays complete.
 */
export type TerminalEvent =
  | TerminalWorkerEvent
  | { type: "title"; sessionId: string; title: string }
  | { type: "created"; sessionId: string; session: TerminalSessionView };

export type TerminalWorkerRequest =
  | { requestId: string; type: "create"; spec: TerminalLaunchSpec }
  | { requestId: string; type: "attach"; sessionId: string }
  | { requestId: string; type: "write"; sessionId: string; data: string }
  | { requestId: string; type: "resize"; sessionId: string; cols: number; rows: number }
  | { requestId: string; type: "stop"; sessionId: string };

export type TerminalWorkerResponse =
  | { requestId: string; ok: true; result?: TerminalSession | TerminalAttachment }
  | { requestId: string; ok: false; error: string };
