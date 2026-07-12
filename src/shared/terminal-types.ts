export type TerminalKind = "powershell" | "claude" | "codex";
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

export type TerminalWorkerRequest =
  | { requestId: string; type: "create"; spec: TerminalLaunchSpec }
  | { requestId: string; type: "attach"; sessionId: string }
  | { requestId: string; type: "write"; sessionId: string; data: string }
  | { requestId: string; type: "resize"; sessionId: string; cols: number; rows: number }
  | { requestId: string; type: "stop"; sessionId: string };

export type TerminalWorkerResponse =
  | { requestId: string; ok: true; result?: TerminalSession | TerminalAttachment }
  | { requestId: string; ok: false; error: string };
