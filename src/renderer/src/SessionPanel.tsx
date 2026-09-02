import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import { ChevronDown, ChevronRight, GitBranch, Wrench, X } from "lucide-react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { SessionNameInput } from "./SessionNameInput";
import { AgentIcon } from "./brand-icons";
import { DocumentPaneIcon, type DocumentPane } from "./pane-items";
import { findAgent, statusLabels } from "./session-labels";
import {
  matchesScope,
  sessionPanelWaitCount,
  type SessionPanelItem,
  type SessionScope,
  type SessionScopeTarget,
} from "./session-panel";

export interface SessionPanelProps {
  /** App이 정렬까지 끝낸 전체 목록. 범위 필터는 여기서 건다. */
  items: readonly SessionPanelItem[];
  scopeTarget: SessionScopeTarget;
  scope: SessionScope;
  onChangeScope(scope: SessionScope): void;
  open: boolean;
  onToggleOpen(): void;
  agents: readonly AgentView[];
  focusedPaneId: string | null;
  onScreenPaneIds: Set<string>;
  renamingSessionId: string | null;
  onSelectSession(session: TerminalSessionView): void;
  onSelectDocument(pane: DocumentPane): void;
  onCloseDocument(pane: DocumentPane): void;
  onSessionContextMenu(session: TerminalSessionView, event: ReactMouseEvent): void;
  onRenameSession(sessionId: string, name: string | null): void;
  onCancelRename(): void;
  /** 사이드바의 드래그 핸들러 — 셸프 하이라이트 해제까지 함께 하므로 그대로 받는다. */
  paneDragProps(paneId: string): {
    draggable: boolean;
    onDragStart(event: ReactDragEvent<HTMLElement>): void;
    onDragEnd(): void;
  };
}

/**
 * 사이드바 하단의 세션 패널. 트리가 "어디에 뭐가 있나"를 답한다면 여기는 "지금 무엇이 나를
 * 기다리나"를 답한다 — 승인 대기부터 위로, 폴더를 가리지 않고. 행의 마크업과 접근성 이름은
 * 트리에 있을 때의 세션·문서 행과 같다(설계 문서 참고).
 */
export function SessionPanel({
  items,
  scopeTarget,
  scope,
  onChangeScope,
  open,
  onToggleOpen,
  agents,
  focusedPaneId,
  onScreenPaneIds,
  renamingSessionId,
  onSelectSession,
  onSelectDocument,
  onCloseDocument,
  onSessionContextMenu,
  onRenameSession,
  onCancelRename,
  paneDragProps,
}: SessionPanelProps) {
  // 범위를 걸 곳이 없으면 저장된 선호가 "여기"여도 전체를 보인다 — 홈에 다녀왔다고 토글이 리셋되면 안 된다.
  const effectiveScope: SessionScope = scopeTarget.kind === "none" ? "all" : scope;
  const visible = effectiveScope === "all" ? items : items.filter((item) => matchesScope(item, scopeTarget));
  const waiting = sessionPanelWaitCount(items);

  /** `current` is the focused pane, `on-screen` the ones the grid is drawing; the rest read as dim. */
  const rowClass = (paneId: string, ...extra: string[]) =>
    [
      "session-row",
      ...extra,
      focusedPaneId === paneId ? "current" : "",
      onScreenPaneIds.has(paneId) ? "on-screen" : "",
    ]
      .filter(Boolean)
      .join(" ");

  /**
   * 소속은 눈에 보이는 별도 span과 `title`에만 넣는다. 접근성 이름에 넣으면 세션 행을 찾는 기존
   * 테스트와 e2e 헬퍼가 통째로 깨지므로, 그것은 별도 작업으로 남긴다(설계 문서 "하지 않는 것").
   */
  const placeOf = (item: SessionPanelItem) => (
    <>
      {item.place ? <span className="session-row-place">{item.place}</span> : null}
      {item.branch ? (
        <span className="session-row-branch">
          <GitBranch size={11} aria-hidden="true" />
          {item.branch}
        </span>
      ) : null}
    </>
  );
  const titleOf = (item: SessionPanelItem) =>
    [item.place, item.branch ? `⎇ ${item.branch}` : null, item.label].filter(Boolean).join(" · ");

  const renderSession = (item: Extract<SessionPanelItem, { kind: "session" }>) => {
    if (renamingSessionId === item.id) {
      return (
        <li key={item.id}>
          <SessionNameInput
            initialName={item.session.name ?? item.label}
            onSubmit={(name) => onRenameSession(item.id, name)}
            onCancel={onCancelRename}
          />
        </li>
      );
    }
    return (
      <li key={item.id}>
        <button
          className={rowClass(item.id, `status-${item.status}`)}
          type="button"
          onClick={() => onSelectSession(item.session)}
          onContextMenu={(event) => onSessionContextMenu(item.session, event)}
          aria-label={`${item.label} 세션 열기${item.attention ? " (읽지 않음)" : ""}`}
          title={titleOf(item)}
          {...paneDragProps(item.id)}
        >
          <span className={`status-dot status-${item.status}`} aria-hidden="true" />
          {item.tool ? <Wrench size={14} /> : <AgentIcon agent={findAgent(agents, item.agent)} size={14} />}
          {placeOf(item)}
          <span className="session-name">{item.label}</span>
          {item.attention ? (
            <span className={`unread-dot unread-${item.attention}`} title="응답 대기" aria-hidden="true" />
          ) : null}
          <span className="session-status">{statusLabels[item.status]}</span>
        </button>
      </li>
    );
  };

  /**
   * A file, diff, commit graph or pull request. A sibling pair of buttons inside the row, not a
   * button nesting a button (invalid HTML — the trap `.brand-block`'s toggle hit before), so 닫기
   * can sit on the same line as 열기.
   */
  const renderDocument = (item: Extract<SessionPanelItem, { kind: "document" }>) => (
    <li key={item.id}>
      <div className={rowClass(item.id, "file-tab-row")} {...paneDragProps(item.id)}>
        <button
          type="button"
          className="file-tab-open"
          onClick={() => onSelectDocument(item.pane)}
          aria-label={`${item.label} 문서 열기${item.dirty ? " (저장 안 됨)" : ""}`}
          title={titleOf(item)}
        >
          <span className={`file-tab-dot ${item.dirty ? "dirty" : ""}`} aria-hidden="true" />
          <DocumentPaneIcon kind={item.document} size={13} />
          {placeOf(item)}
          <span className="session-name">{item.label}</span>
        </button>
        <button
          type="button"
          className="file-tab-close"
          onClick={() => onCloseDocument(item.pane)}
          aria-label={`${item.label} 닫기`}
          title="닫기"
        >
          <X size={12} />
        </button>
      </div>
    </li>
  );

  return (
    <section className="session-panel" aria-label="세션 패널">
      <div className="section-heading session-panel-heading">
        <button
          className="tree-toggle"
          type="button"
          onClick={onToggleOpen}
          aria-label={`세션 패널 ${open ? "접기" : "펼치기"}`}
          title={`세션 패널 ${open ? "접기" : "펼치기"}`}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <span>세션</span>
        {/* 접혀 있어도 보인다 — 그래야 접어 둔 채로도 무엇이 기다리는지 알 수 있다. */}
        {waiting > 0 ? <span className="session-panel-wait">대기 {waiting}</span> : null}
        <div className="session-panel-scope" role="group" aria-label="세션 범위">
          <button type="button" aria-pressed={effectiveScope === "all"} onClick={() => onChangeScope("all")}>
            전체
          </button>
          <button
            type="button"
            aria-pressed={effectiveScope === "here"}
            disabled={scopeTarget.kind === "none"}
            title={scopeTarget.kind === "none" ? "지금 화면에는 범위로 삼을 폴더가 없습니다" : scopeTarget.label}
            onClick={() => onChangeScope("here")}
          >
            여기
          </button>
        </div>
      </div>
      {open ? (
        <ul className="session-tree session-panel-list" role="group" aria-label="세션 목록">
          {visible.length === 0 && scopeTarget.kind !== "none" ? (
            <li className="session-panel-empty">{scopeTarget.label}에 열린 세션이 없습니다</li>
          ) : null}
          {visible.map((item) => (item.kind === "session" ? renderSession(item) : renderDocument(item)))}
        </ul>
      ) : null}
    </section>
  );
}
