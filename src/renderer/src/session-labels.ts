import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalKind, TerminalStatus, ToolCommand } from "@shared/terminal-types";
import { Bot, Code2, Terminal as TerminalIcon } from "lucide-react";

export const providerDetails: Record<TerminalKind, { label: string; menuLabel: string; icon: typeof TerminalIcon }> = {
  powershell: { label: "PowerShell", menuLabel: "New PowerShell session", icon: TerminalIcon },
  claude: { label: "Claude Code", menuLabel: "New Claude Code session", icon: Bot },
  codex: { label: "Codex", menuLabel: "New Codex session", icon: Code2 },
};

export const toolDetails: Record<ToolCommand, { label: string; menuLabel: string }> = {
  "claude-update": { label: "Claude Code update", menuLabel: "Update Claude Code" },
  "codex-update": { label: "Codex update", menuLabel: "Update Codex" },
};

export const statusLabels: Record<TerminalStatus, string> = {
  starting: "Starting",
  working: "Working",
  "awaiting-input": "Input needed",
  "awaiting-approval": "Approval needed",
  idle: "Idle",
  exited: "Exited",
  error: "Error",
};

export function projectName(project: SharedProject): string {
  const fallback = project.rootPath.split(/[\\/]/).filter(Boolean).at(-1);
  return project.displayName?.trim() || fallback || project.rootPath;
}

/**
 * Sessions of the same kind in the same folder are numbered so they stay tellable apart.
 * A maintenance session is named for its command, not for the shell that happens to run it.
 */
export function sessionLabel(session: TerminalSessionView, peers: TerminalSessionView[]): string {
  if (session.tool) return toolDetails[session.tool].label;
  const base = providerDetails[session.kind].label;
  const sameKind = peers
    .filter((candidate) => !candidate.tool && candidate.kind === session.kind)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  if (sameKind.length < 2) return base;
  return `${base} ${sameKind.findIndex((candidate) => candidate.id === session.id) + 1}`;
}
