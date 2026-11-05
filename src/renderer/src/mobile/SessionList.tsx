import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Ellipsis, Eye, EyeOff, GitBranch, Plus } from "lucide-react";
import type { RemoteSessionSummary, RemoteShelf } from "@shared/remote-types";
import { AgentIcon } from "../brand-icons";
import { statusLabels } from "../session-labels";
import { SHELF_TEXT } from "../shelves";
import { CONNECTION_LABEL, HostMenu } from "./HostMenu";
import type { RemoteClientState } from "./remote-client";
import { awaitingCount, isAwaiting, nextAwaiting, placeOf, splitShelves } from "./session-list-model";
import { useOverlayEntry } from "./use-session-drawer";

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
  /**
   * panel: 넓은 화면 왼쪽 목록 — 메인 창 사이드바처럼 한 줄 행. phone: 폰의 홈 화면 — 두 줄 행, 아이콘
   * 머리줄, 연결 해제는 ⋯ 메뉴 안.
   */
  variant?: "panel" | "phone";
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
  variant = "panel",
}: SessionListProps) {
  const phone = variant === "phone";
  const [waitingOnly, setWaitingOnly] = useState(loadWaitingOnly);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const hostMenu = useOverlayEntry("host-menu");
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
  const leave = leaveLabel ?? "연결 해제";

  const shelfButton = (session: RemoteSessionSummary, shelf: RemoteShelf) => {
    if (!onMoveShelf) return null;
    const target: RemoteShelf = shelf === "active" ? "hidden" : "active";
    return (
      <button
        type="button"
        className="m-row-action"
        aria-label={`${session.label} ${SHELF_TEXT[shelf].move}`}
        title={SHELF_TEXT[shelf].moveTitle}
        disabled={connection !== "open"}
        onClick={() => onMoveShelf(session.id, target)}
      >
        {shelf === "active" ? <EyeOff size={phone ? 18 : 14} /> : <Eye size={phone ? 18 : 14} />}
      </button>
    );
  };

  const rowClass = (session: RemoteSessionSummary) =>
    [
      "m-row",
      phone ? "m-row-phone" : "",
      `status-${session.status}`,
      session.id === focusedId ? "current" : onScreen(session.id) ? "on-screen" : "",
    ]
      .filter(Boolean)
      .join(" ");

  /** 폰: 이름이 잘리지 않게 두 줄 — 위는 이름과 상태, 아래는 폴더와 브랜치. */
  const phoneRow = (session: RemoteSessionSummary, shelf: RemoteShelf) => (
    <li key={session.id}>
      <div className={rowClass(session)}>
        <button
          type="button"
          className="m-row-open"
          aria-label={`${session.label}, ${statusLabels[session.status]}`}
          title={session.label}
          onClick={() => onOpen(session.id)}
        >
          <span className={`m-dot m-dot-${session.status}`} aria-hidden="true" />
          <AgentIcon agent={remoteAgent(session)} size={18} />
          <span className="m-row-text">
            <span className="m-row-name">{session.label}</span>
            <span className="m-row-sub">
              {session.projectName ? <span className="m-row-place">{session.projectName}</span> : null}
              {session.worktreeBranch ? (
                <span className="m-row-branch">
                  <GitBranch size={11} aria-hidden="true" />
                  {session.worktreeBranch}
                </span>
              ) : null}
            </span>
          </span>
          <span className={`m-status m-status-${session.status}`}>{statusLabels[session.status]}</span>
        </button>
        {shelfButton(session, shelf)}
      </div>
    </li>
  );

  const panelRow = (session: RemoteSessionSummary, previous: RemoteSessionSummary | undefined, shelf: RemoteShelf) => {
    const repeated = previous !== undefined && placeOf(previous) === placeOf(session);
    const title = [session.projectName, session.worktreeBranch ? `⎇ ${session.worktreeBranch}` : null, session.label]
      .filter(Boolean)
      .join(" · ");
    return (
      <li key={session.id}>
        <div className={rowClass(session)}>
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
          {shelfButton(session, shelf)}
        </div>
      </li>
    );
  };

  const rows = (list: RemoteSessionSummary[], shelf: RemoteShelf) => {
    if (!phone) return list.map((session, index) => panelRow(session, list[index - 1], shelf));
    // 폰: 답을 기다리는 세션이 위에 모여 있다(정렬) — 그 묶음에 이름을 붙인다.
    const firstCalm = list.findIndex((session) => !isAwaiting(session.status));
    return list.flatMap((session, index) => {
      const label =
        shelf === "active" && index === 0 && isAwaiting(session.status)
          ? "응답 대기"
          : shelf === "active" && index === firstCalm && firstCalm > 0
            ? "세션"
            : null;
      const row = phoneRow(session, shelf);
      return label
        ? [
            <li
              key={`label:${label}`}
              className={label === "응답 대기" ? "m-rows-label m-rows-label-await" : "m-rows-label"}
              aria-hidden="true"
            >
              {label}
            </li>,
            row,
          ]
        : [row];
    });
  };

  const hiddenName = SHELF_TEXT.hidden.name;
  const hiddenExpanded = hiddenOpen && hidden.length > 0;
  return (
    <main className={phone ? "m-list m-list-phone" : "m-list"}>
      {phone ? (
        <header className="m-topbar">
          <span className={`m-conn m-conn-${connection}`} aria-hidden="true" />
          <div className="m-title m-title-static">
            <h1 className="m-title-text">{hostName}</h1>
            <span className="m-title-sub">
              세션 {active.length}개 · {banner ?? "연결됨"}
            </span>
          </div>
          <button type="button" className="m-icon" aria-label="새 세션" disabled={connection !== "open"} onClick={onNewSession}>
            <Plus size={22} aria-hidden="true" />
          </button>
          <button type="button" className="m-icon" aria-label="호스트 메뉴" aria-haspopup="dialog" onClick={hostMenu.open}>
            <Ellipsis size={22} aria-hidden="true" />
          </button>
        </header>
      ) : (
        <header className="m-bar">
          <h1>{hostName}</h1>
          <button type="button" disabled={connection !== "open"} onClick={onNewSession}>
            새 세션
          </button>
          <button type="button" onClick={onUnpair}>
            {leave}
          </button>
        </header>
      )}
      {banner ? <p className={phone ? "m-banner m-conn-strip" : "m-banner"}>{banner}</p> : null}
      {children}
      <section className="m-panel" aria-label="세션">
        {phone ? (
          <div className="m-panel-heading">
            <div className="m-seg" role="group" aria-label="세션 범위">
              <button type="button" aria-pressed={!waitingOnly} onClick={() => changeWaitingOnly(false)}>
                전체 {active.length}
              </button>
              <button
                type="button"
                aria-pressed={waitingOnly}
                title="입력·승인을 기다리는 세션만 보기"
                onClick={() => changeWaitingOnly(true)}
              >
                대기 {awaitingCount(active, null)}
              </button>
            </div>
          </div>
        ) : (
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
        )}
        <ul className="m-rows" aria-label="세션 목록">
          {visible.length === 0 ? (
            <li className="m-empty">{waitingOnly ? "기다리는 세션이 없습니다" : "열린 세션이 없습니다"}</li>
          ) : null}
          {rows(visible, "active")}
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
              {rows(hidden, "hidden")}
            </ul>
          ) : null}
        </section>
      ) : null}
      {footer}
      {phone && hostMenu.isOpen ? (
        <HostMenu
          hostName={hostName}
          connection={connection}
          leaveLabel={leaveLabel}
          onLeave={() => hostMenu.close(onUnpair)}
          onClose={() => hostMenu.close()}
        />
      ) : null}
    </main>
  );
}
