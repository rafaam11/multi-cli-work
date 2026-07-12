import type { TerminalSessionView, UpdaterStatus } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalKind, TerminalStatus, ToolCommand } from "@shared/terminal-types";
import { Bot, Code2, Terminal as TerminalIcon } from "lucide-react";

export const providerDetails: Record<TerminalKind, { label: string; menuLabel: string; icon: typeof TerminalIcon }> = {
  powershell: { label: "PowerShell", menuLabel: "새 PowerShell 세션", icon: TerminalIcon },
  claude: { label: "Claude Code", menuLabel: "새 Claude Code 세션", icon: Bot },
  codex: { label: "Codex", menuLabel: "새 Codex 세션", icon: Code2 },
};

export const toolDetails: Record<ToolCommand, { label: string; menuLabel: string }> = {
  "claude-update": { label: "Claude Code 업데이트", menuLabel: "Claude Code 업데이트" },
  "codex-update": { label: "Codex 업데이트", menuLabel: "Codex 업데이트" },
};

export const statusLabels: Record<TerminalStatus, string> = {
  starting: "시작 중",
  working: "작업 중",
  "awaiting-input": "입력 대기",
  "awaiting-approval": "승인 대기",
  idle: "대기",
  exited: "종료됨",
  error: "오류",
};

export function projectName(project: SharedProject): string {
  const fallback = project.rootPath.split(/[\\/]/).filter(Boolean).at(-1);
  return project.displayName?.trim() || fallback || project.rootPath;
}

export function relativeTime(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}

export function updaterStatusLabel(status: UpdaterStatus): string {
  switch (status.state) {
    case "checking":
      return "업데이트 확인 중";
    case "available":
      return `${status.version} 업데이트 가능`;
    case "downloading":
      return `다운로드 중 ${status.percent}%`;
    case "downloaded":
      return `${status.version} 업데이트 설치 준비 완료`;
    case "error":
      return "업데이트 확인 실패";
    default:
      return "최신 버전";
  }
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
