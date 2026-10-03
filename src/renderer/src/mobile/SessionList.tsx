import type { TerminalStatus } from "@shared/terminal-types";
import type { RemoteSessionSummary } from "@shared/remote-types";
import type { RemoteClientState } from "./remote-client";
import { groupSessions } from "./session-list-model";

export const STATUS_LABEL: Record<TerminalStatus, string> = {
  starting: "시작 중",
  working: "작업 중",
  "awaiting-input": "입력 대기",
  "awaiting-approval": "승인 대기",
  idle: "대기",
  exited: "종료됨",
  error: "오류",
};

const CONNECTION_LABEL: Record<RemoteClientState, string | null> = {
  connecting: "연결 중…",
  open: null,
  reconnecting: "다시 연결하는 중…",
  unauthorized: "연결이 해제되었습니다",
};

interface SessionListProps {
  hostName: string;
  connection: RemoteClientState;
  sessions: RemoteSessionSummary[];
  onOpen(sessionId: string): void;
  onUnpair(): void;
  leaveLabel?: string;
  /** 넓은 화면에서 옆에 열려 있는 세션. */
  activeSessionId?: string | null;
}

export function SessionList({ hostName, connection, sessions, onOpen, onUnpair, leaveLabel, activeSessionId }: SessionListProps) {
  const banner = CONNECTION_LABEL[connection];
  return (
    <main className="m-list">
      <header className="m-bar">
        <h1>{hostName}</h1>
        <button type="button" onClick={onUnpair}>
          {leaveLabel ?? "연결 해제"}
        </button>
      </header>
      {banner ? <p className="m-banner">{banner}</p> : null}
      {sessions.length === 0 ? <p className="m-empty">열린 세션이 없습니다</p> : null}
      {groupSessions(sessions).map((group) => (
        <section key={group.projectName}>
          <h2>{group.projectName}</h2>
          {group.sessions.map((session) => (
            <button
              type="button"
              className="m-session"
              key={session.id}
              aria-current={session.id === activeSessionId ? "true" : undefined}
              onClick={() => onOpen(session.id)}
            >
              <span className="m-session-label">{session.label}</span>
              <span className={`m-status m-status-${session.status}`}>{STATUS_LABEL[session.status]}</span>
            </button>
          ))}
        </section>
      ))}
    </main>
  );
}
