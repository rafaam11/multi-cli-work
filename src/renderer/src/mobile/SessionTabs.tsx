import { useEffect, useRef } from "react";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { statusLabels as STATUS_LABEL } from "../session-labels";
import { awaitingCount, isAwaiting, nextAwaiting } from "./session-list-model";

interface SessionTabsProps {
  /** 호스트가 보낸 순서 그대로 — 정렬하면 상태가 바뀔 때마다 칩이 자리를 옮긴다. */
  sessions: RemoteSessionSummary[];
  activeSessionId: string;
  onSelect(sessionId: string): void;
  onNewSession(): void;
}

/** 좁은 화면의 세션 화면 위에 두는 가로 칩 줄. 목록에 나가지 않고 다른 세션으로 옮긴다. */
export function SessionTabs({ sessions: all, activeSessionId, onSelect, onNewSession }: SessionTabsProps) {
  // 숨긴 세션은 칩에 두지 않는다 — 숨김 칸에서 직접 연 세션이면 그것만 남긴다.
  const sessions = all.filter((session) => !session.hidden || session.id === activeSessionId);
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
  }, [activeSessionId]);

  const labelCounts = new Map<string, number>();
  for (const session of sessions) labelCounts.set(session.label, (labelCounts.get(session.label) ?? 0) + 1);
  const waiting = awaitingCount(sessions, activeSessionId);

  return (
    <nav className="m-tabs" aria-label="세션 탭">
      {waiting > 0 ? (
        <button
          type="button"
          className="m-await-jump"
          onClick={() => {
            const next = nextAwaiting(sessions, activeSessionId);
            if (next) onSelect(next.id);
          }}
        >
          대기 {waiting}
        </button>
      ) : null}
      {sessions.map((session) => {
        const active = session.id === activeSessionId;
        const label =
          (labelCounts.get(session.label) ?? 0) > 1 && session.projectName
            ? `${session.label} · ${session.projectName}`
            : session.label;
        return (
          <button
            type="button"
            key={session.id}
            ref={active ? activeRef : undefined}
            className={isAwaiting(session.status) ? "m-tab m-tab-awaiting" : "m-tab"}
            aria-current={active ? "true" : undefined}
            aria-label={`${label}, ${STATUS_LABEL[session.status]}`}
            onClick={() => {
              if (!active) onSelect(session.id);
            }}
          >
            <span className={`m-dot m-dot-${session.status}`} aria-hidden="true" />
            <span className="m-tab-label">{label}</span>
          </button>
        );
      })}
      <button type="button" className="m-tab m-tab-new" aria-label="새 세션" onClick={onNewSession}>
        +
      </button>
    </nav>
  );
}
