import type { TerminalSessionView } from "@shared/api-types";
import type { TerminalStatus } from "@shared/terminal-types";

const SIGNALS: { status: TerminalStatus; label: string }[] = [
  { status: "working", label: "작업 중" },
  { status: "awaiting-input", label: "입력 대기" },
  { status: "awaiting-approval", label: "승인 대기" },
  { status: "error", label: "오류" },
];

export function ControlOverview({ sessions, onSelectSession }: {
  sessions: TerminalSessionView[];
  onSelectSession(session: TerminalSessionView): void;
}) {
  return <section className="control-overview" aria-label="관제 요약">
    <header><span>WORKSPACE CONTROL</span><span>세션 {sessions.length}개</span></header>
    <div className="control-signals">
      {SIGNALS.map(({ status, label }) => {
        const matches = sessions.filter(session => session.status === status)
          .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
        return <button key={status} type="button" className={`control-signal status-${status}`}
          disabled={matches.length === 0} onClick={() => onSelectSession(matches[0])}
          aria-label={`${label} ${matches.length}개${matches.length ? ", 가장 오래된 세션 열기" : ""}`}>
          <span className="status-dot" aria-hidden="true" />
          <span>{label}</span><strong>{matches.length}</strong>
          <small>{matches.length ? "세션으로 이동 →" : "해당 세션 없음"}</small>
        </button>;
      })}
    </div>
  </section>;
}
