import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, GitBranch } from "lucide-react";
import type { RemoteSessionSummary, RemoteShelf } from "@shared/remote-types";
import { AgentIcon } from "../brand-icons";
import { statusLabels } from "../session-labels";
import { SHELF_TEXT } from "../shelves";
import type { RemoteClientState } from "./remote-client";
import { awaitingCount, isAwaiting, nextAwaiting, placeOf, splitShelves } from "./session-list-model";

const CONNECTION_LABEL: Record<RemoteClientState, string | null> = {
  connecting: "연결 중…",
  open: null,
  reconnecting: "다시 연결하는 중…",
  unauthorized: "연결이 해제되었습니다",
  incompatible: "호스트와 버전이 맞지 않습니다",
};

/** 전체/대기 범위는 이 기기의 취향이라 기기에만 둔다. */
const WAITING_ONLY_KEY = "mcw.remote.waitingOnly.v1";

function loadWaitingOnly(): boolean {
  try {
    return window.localStorage.getItem(WAITING_ONLY_KEY) === "1";
  } catch {
    return false;
  }
}

function saveWaitingOnly(value: boolean): void {
  try {
    window.localStorage.setItem(WAITING_ONLY_KEY, value ? "1" : "0");
  } catch {
    /* unavailable storage */
  }
}

/** 원격 요약에는 에이전트 정의가 없다 — 종류 id로 메인 창과 같은 아이콘을 고른다. */
export function remoteAgent(session: Pick<RemoteSessionSummary, "kind">) {
  return { id: session.kind, label: session.kind, icon: session.kind, accentColor: null };
}

interface SessionListProps {
  hostName: string;
  connection: RemoteClientState;
  sessions: RemoteSessionSummary[];
  onOpen(sessionId: string): void;
  onUnpair(): void;
  leaveLabel?: string;
  /** 넓은 화면에서 키보드 입력을 받는(포커스) 세션. */
  activeSessionId?: string | null;
  /** 넓은 화면 그리드에 떠 있는 세션들 — 포커스 세션을 포함한다. */
  onScreenSessionIds?: readonly string[];
  onNewSession(): void;
  /** 호스트 메인 창의 선반을 옮긴다. 없으면 숨기기 버튼을 그리지 않는다. */
  onMoveShelf?(sessionId: string, shelf: RemoteShelf): void;
  /** 머리줄 아래에 그리는 것 — 새 세션 폼. */
  children?: ReactNode;
  /** 숨김 선반 아래에 그리는 것 — 프로젝트 트리. */
  footer?: ReactNode;
}

export function SessionList({
  hostName,
  connection,
  sessions,
  onOpen,
  onUnpair,
  leaveLabel,
  activeSessionId = null,
  onScreenSessionIds = [],
  onNewSession,
  onMoveShelf,
  children,
  footer,
}: SessionListProps) {
  const [waitingOnly, setWaitingOnly] = useState(loadWaitingOnly);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const banner = CONNECTION_LABEL[connection];
  const { active, hidden } = splitShelves(sessions);
  const focusedId = activeSessionId;
  const onScreen = (id: string) => id === focusedId || onScreenSessionIds.includes(id);
  const waiting = awaitingCount(active, focusedId);
  const visible = waitingOnly ? active.filter((session) => isAwaiting(session.status)) : active;
  const changeWaitingOnly = (value: boolean) => {
    setWaitingOnly(value);
    saveWaitingOnly(value);
  };

  const row = (session: RemoteSessionSummary, previous: RemoteSessionSummary | undefined, shelf: RemoteShelf) => {
    const repeated = previous !== undefined && placeOf(previous) === placeOf(session);
    const target: RemoteShelf = shelf === "active" ? "hidden" : "active";
    const title = [session.projectName, session.worktreeBranch ? `⎇ ${session.worktreeBranch}` : null, session.label]
      .filter(Boolean)
      .join(" · ");
    return (
      <li key={session.id}>
        <div
          className={[
            "m-row",
            `status-${session.status}`,
            session.id === focusedId ? "current" : onScreen(session.id) ? "on-screen" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <button
            type="button"
            className="m-row-open"
            aria-label={`${session.label}, ${statusLabels[session.status]}`}
            aria-current={onScreen(session.id) ? "true" : undefined}
            title={title}
            onClick={() => onOpen(session.id)}
          >
            <span className={`m-dot m-dot-${session.status}`} aria-hidden="true" />
            <AgentIcon agent={remoteAgent(session)} size={14} />
            {!repeated && session.projectName ? <span className="m-row-place">{session.projectName}</span> : null}
            {!repeated && session.worktreeBranch ? (
              <span className="m-row-branch">
                <GitBranch size={11} aria-hidden="true" />
                {session.worktreeBranch}
              </span>
            ) : null}
            <span className="m-row-name">{session.label}</span>
            <span className={`m-status m-status-${session.status}`}>{statusLabels[session.status]}</span>
          </button>
          {onMoveShelf ? (
            <button
              type="button"
              className="m-row-action"
              aria-label={`${session.label} ${SHELF_TEXT[shelf].move}`}
              title={SHELF_TEXT[shelf].moveTitle}
              disabled={connection !== "open"}
              onClick={() => onMoveShelf(session.id, target)}
            >
              {shelf === "active" ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          ) : null}
        </div>
      </li>
    );
  };

  const hiddenName = SHELF_TEXT.hidden.name;
  const hiddenExpanded = hiddenOpen && hidden.length > 0;
  return (
    <main className="m-list">
      <header className="m-bar">
        <h1>{hostName}</h1>
        <button type="button" disabled={connection !== "open"} onClick={onNewSession}>
          새 세션
        </button>
        <button type="button" onClick={onUnpair}>
          {leaveLabel ?? "연결 해제"}
        </button>
      </header>
      {banner ? <p className="m-banner">{banner}</p> : null}
      {children}
      <section className="m-panel" aria-label="세션">
        <div className="m-panel-heading">
          <h2>세션</h2>
          {waiting > 0 ? (
            <button
              type="button"
              className="m-await-jump"
              onClick={() => {
                const next = nextAwaiting(active, focusedId);
                if (next) onOpen(next.id);
              }}
            >
              대기 {waiting}
            </button>
          ) : null}
          <div className="m-scope" role="group" aria-label="세션 범위">
            <button type="button" aria-pressed={!waitingOnly} onClick={() => changeWaitingOnly(false)}>
              전체
            </button>
            <button
              type="button"
              aria-pressed={waitingOnly}
              title="입력·승인을 기다리는 세션만 보기"
              onClick={() => changeWaitingOnly(true)}
            >
              대기
            </button>
          </div>
        </div>
        <ul className="m-rows" aria-label="세션 목록">
          {visible.length === 0 ? (
            <li className="m-empty">{waitingOnly ? "기다리는 세션이 없습니다" : "열린 세션이 없습니다"}</li>
          ) : null}
          {visible.map((session, index) => row(session, visible[index - 1], "active"))}
        </ul>
      </section>
      {hidden.length > 0 ? (
        <section className="m-panel m-hidden-shelf" aria-label={hiddenName}>
          <button
            type="button"
            className="m-shelf-toggle"
            aria-expanded={hiddenExpanded}
            onClick={() => setHiddenOpen((open) => !open)}
          >
            {hiddenExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <EyeOff size={14} />
            <span className="m-shelf-name">{hiddenName}</span>
            <span className="m-shelf-count">{hidden.length}</span>
          </button>
          {hiddenExpanded ? (
            <ul className="m-rows" aria-label={`${hiddenName} 세션`}>
              {hidden.map((session, index) => row(session, hidden[index - 1], "hidden"))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {footer}
    </main>
  );
}
