import type { TerminalStatus } from "@shared/terminal-types";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { sessionRank } from "../session-panel";

export { applySessionMessage } from "@shared/remote-session-list";

/** 사람이 답해야 다음으로 넘어가는 상태 — 입력 대기와 승인 대기. */
export function isAwaiting(status: TerminalStatus): boolean {
  return status === "awaiting-input" || status === "awaiting-approval";
}

/** 지금 세션 다음부터 한 바퀴 돌며 찾은 대기 세션. 지금 세션은 빼고, 없으면 null. */
export function nextAwaiting(sessions: RemoteSessionSummary[], currentId: string | null): RemoteSessionSummary | null {
  const start = sessions.findIndex((session) => session.id === currentId);
  for (let step = 1; step <= sessions.length; step += 1) {
    const candidate = sessions[(start + step + sessions.length) % sessions.length];
    if (candidate.id !== currentId && isAwaiting(candidate.status)) return candidate;
  }
  return null;
}

/** 지금 세션을 뺀 대기 세션 수. */
export function awaitingCount(sessions: RemoteSessionSummary[], currentId: string | null): number {
  return sessions.filter((session) => session.id !== currentId && isAwaiting(session.status)).length;
}

/** 메인 창 세션 패널과 같은 순서 — 급한 상태가 위, 같은 등급이면 최근 것이 위. */
export function sortSessions(sessions: readonly RemoteSessionSummary[]): RemoteSessionSummary[] {
  return [...sessions].sort(
    (a, b) => sessionRank(a.status, null) - sessionRank(b.status, null) || b.updatedAt.localeCompare(a.updatedAt),
  );
}

/** 목록 화면: 호스트 메인 창의 작업공간 세션과, 맨 아래 접힌 칸에 둘 숨긴 세션. 둘 다 정렬해서. */
export function splitShelves(sessions: readonly RemoteSessionSummary[]) {
  return {
    active: sortSessions(sessions.filter((session) => !session.hidden)),
    hidden: sortSessions(sessions.filter((session) => session.hidden)),
  };
}

/** 행의 소속 표시 — 폴더명(없으면 null)과 브랜치. 바로 위 행과 같으면 칸은 비운다. */
export function placeOf(session: RemoteSessionSummary): string {
  return `${session.projectName ?? ""}\u0000${session.worktreeBranch ?? ""}`;
}
