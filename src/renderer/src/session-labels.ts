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

/** A session shows what it is working on: the name the user gave it, else the provider's title. */
function ownName(session: TerminalSessionView): string | null {
  const name = session.name?.trim();
  if (name) return name;
  if (session.tool) return toolDetails[session.tool].label;
  return session.title?.trim() || null;
}

/**
 * Sessions with nothing to show fall back to the provider name, and those are numbered so they stay
 * tellable apart. Numbering only counts the other fallbacks, so it stays contiguous as titles arrive.
 */
export function sessionLabel(session: TerminalSessionView, peers: TerminalSessionView[]): string {
  const own = ownName(session);
  if (own) return own;
  const base = providerDetails[session.kind].label;
  const unnamed = peers
    .filter((candidate) => candidate.kind === session.kind && ownName(candidate) === null)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  if (unnamed.length < 2) return base;
  return `${base} ${unnamed.findIndex((candidate) => candidate.id === session.id) + 1}`;
}
