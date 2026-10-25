import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import { ChevronDown, ChevronRight, EyeOff } from "lucide-react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import { DocumentRow, SessionRow } from "./PaneRows";
import { findAgent } from "./session-labels";
import {
  isWaitingItem,
  sessionPanelWaitCount,
  type SessionPanelItem,
} from "./session-panel";

export interface SessionPanelProps {
  /** 작업공간 선반에 속한 패인만, 선반 슬롯 순서로 받는다. */
  items: readonly SessionPanelItem[];
  /** Keeps only sessions asking for input or approval. */
  waitingOnly: boolean;
  onChangeWaitingOnly(waitingOnly: boolean): void;
  open: boolean;
  onToggleOpen(): void;
  selected: boolean;
  dropTarget: boolean;
  onSelectWorkspace(): void;
  onSelectPane(paneId: string): void;
  onMovePaneToHidden(paneId: string): void;
  agents: readonly AgentView[];
  focusedPaneId: string | null;
  onScreenPaneIds: Set<string>;
  renamingSessionId: string | null;
  onSessionContextMenu(session: TerminalSessionView, event: ReactMouseEvent): void;
  onRenameSession(sessionId: string, name: string | null): void;
  onCancelRename(): void;
  /** 사이드바의 드래그 핸들러 — 셸프 하이라이트 해제까지 함께 하므로 그대로 받는다. */
  paneDragProps(paneId: string): {
    draggable: boolean;
    onDragStart(event: ReactDragEvent<HTMLElement>): void;
    onDragEnd(): void;
  };
  paneDropClass(paneId: string): string;
  paneDropProps(paneId: string): {
    onDragOver(event: ReactDragEvent<HTMLElement>): void;
    onDragLeave(event: ReactDragEvent<HTMLElement>): void;
    onDrop(event: ReactDragEvent<HTMLElement>): void;
  };
  headingDropProps: {
    onDragOver(event: ReactDragEvent<HTMLElement>): void;
    onDragLeave(event: ReactDragEvent<HTMLElement>): void;
    onDrop(event: ReactDragEvent<HTMLElement>): void;
  };
}

/**
 * 사이드바 상단에서 작업공간 선반을 대신하는 세션 패널. 슬롯 순서를 보존하면서 현재 상태와
 * 대기 수를 함께 보여 주고, 행 선택·숨김·재정렬은 기존 작업공간과 같은 경로를 사용한다.
 */
export function SessionPanel({
  items,
  waitingOnly,
  onChangeWaitingOnly,
  open,
  onToggleOpen,
  selected,
  dropTarget,
  onSelectWorkspace,
  onSelectPane,
  onMovePaneToHidden,
  agents,
  focusedPaneId,
  onScreenPaneIds,
  renamingSessionId,
  onSessionContextMenu,
  onRenameSession,
  onCancelRename,
  paneDragProps,
  paneDropClass,
  paneDropProps,
  headingDropProps,
}: SessionPanelProps) {
  const visible = waitingOnly ? items.filter(isWaitingItem) : items;
  const waiting = sessionPanelWaitCount(items);

  /**
   * 행 오른쪽 끝의 숨김(눈) 버튼. 트리 행에는 없는, 이 패널만의 동작이라 `trailing`으로 붙인다.
   */
  const hideButton = (item: SessionPanelItem) => (
    <button
      type="button"
      className="file-tab-close"
      onClick={() => onMovePaneToHidden(item.id)}
      aria-label={`${item.label} 작업공간에서 숨기기`}
      title={
        item.kind === "session"
          ? "작업공간에서 숨기기 (세션은 계속 실행됩니다)"
          : "작업공간에서 숨기기 (문서는 계속 열려 있습니다)"
      }
    >
      <EyeOff size={12} />
    </button>
  );

  /**
   * 트리 행과 같은 컴포넌트를 쓰되 동사만 `패인 열기`다(R8) — 트리에도 같은 세션의 행이 서므로
   * 한 화면에 같은 접근성 이름이 둘이면 안 된다. 소속(폴더·브랜치)은 여기서만 보인다: 이 목록은
   * 여러 폴더의 패인을 한데 모으니까.
   */
  const renderSession = (item: Extract<SessionPanelItem, { kind: "session" }>, previous?: SessionPanelItem) => (
    <SessionRow
      key={item.id}
      session={item.session}
      label={item.label}
      place={item.place}
      branch={item.branch}
      agent={findAgent(agents, item.agent)}
      tool={item.tool}
      attention={item.attention}
      current={focusedPaneId === item.id}
      onScreen={onScreenPaneIds.has(item.id)}
      verb="패인 열기"
      placeRepeated={
        previous?.kind === "session" && previous.place === item.place && previous.branch === item.branch
      }
      onSelect={() => onSelectPane(item.id)}
      onContextMenu={(event) => onSessionContextMenu(item.session, event)}
      renaming={renamingSessionId === item.id}
      initialName={item.session.name ?? item.label}
      onRename={(name) => onRenameSession(item.id, name)}
      onCancelRename={onCancelRename}
      dragProps={paneDragProps(item.id)}
      dropClass={paneDropClass(item.id)}
      dropProps={paneDropProps(item.id)}
      trailing={hideButton(item)}
    />
  );

  const renderDocument = (item: Extract<SessionPanelItem, { kind: "document" }>) => (
    <DocumentRow
      key={item.id}
      pane={item.pane}
      label={item.label}
      place={item.place}
      branch={item.branch}
      current={focusedPaneId === item.id}
      onScreen={onScreenPaneIds.has(item.id)}
      verb="패인 열기"
      onOpen={() => onSelectPane(item.id)}
      dragProps={paneDragProps(item.id)}
      dropClass={paneDropClass(item.id)}
      dropProps={paneDropProps(item.id)}
      trailing={hideButton(item)}
    />
  );

  return (
    <section className="session-panel" aria-label="세션 패널">
      <div
        className={[
          "section-heading",
          "session-panel-heading",
          selected ? "selected" : "",
          dropTarget ? "drop-target" : "",
        ].filter(Boolean).join(" ")}
        {...headingDropProps}
      >
        <button
          className="tree-toggle"
          type="button"
          onClick={onToggleOpen}
          aria-label={`세션 패널 ${open ? "접기" : "펼치기"}`}
          title={`세션 패널 ${open ? "접기" : "펼치기"}`}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {/* 제목 버튼이 토글과 범위 버튼 사이의 남는 폭을 전부 먹는다 — 숨김 셸프 행(.workspace-shelf-select)이
            아이콘·이름·개수를 한 버튼에 품는 것과 같은 구조다. 배지가 버튼 밖이면 헤더에서 가장 눌리기 쉬운
            자리가 죽은 공간이 된다. */}
        <button
          className="session-panel-title"
          type="button"
          onClick={onSelectWorkspace}
          aria-label={`세션 작업공간 열기 (패인 ${items.length}개)`}
        >
          <span className="session-panel-name">세션</span>
          {/* 접혀 있어도 보인다 — 그래야 접어 둔 채로도 무엇이 기다리는지 알 수 있다. */}
          {waiting > 0 ? <span className="session-panel-wait">대기 {waiting}</span> : null}
        </button>
        <div className="session-panel-scope" role="group" aria-label="세션 범위">
          <button type="button" aria-pressed={!waitingOnly} onClick={() => onChangeWaitingOnly(false)}>
            전체
          </button>
          <button
            type="button"
            aria-pressed={waitingOnly}
            title="입력·승인을 기다리는 세션만 보기"
            onClick={() => onChangeWaitingOnly(true)}
          >
            대기
          </button>
        </div>
      </div>
      {open ? (
        <ul className="session-tree session-panel-list" role="group" aria-label="세션 목록">
          {visible.length === 0 ? (
            <li className="session-panel-empty">
              {waitingOnly ? "기다리는 세션이 없습니다" : "열린 세션이 없습니다"}
            </li>
          ) : null}
          {visible.map((item, index) =>
            item.kind === "session" ? renderSession(item, visible[index - 1]) : renderDocument(item),
          )}
        </ul>
      ) : null}
    </section>
  );
}
