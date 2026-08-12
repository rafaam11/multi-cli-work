import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import {
  Briefcase,
  CircleStop,
  Folder,
  GitBranch,
  RefreshCw,
  RotateCcw,
  Square,
  SquareSplitVertical,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { AgentIcon, agentAccentClass } from "./brand-icons";
import { MAX_LAYOUT_SLOTS } from "./grid-layouts";
import type { PaneContext } from "./pane-context";
import { SessionNameInput } from "./SessionNameInput";
import { startSessionDrag } from "./session-drag";
import { findAgent, statusLabels } from "./session-labels";

/** What a pane needs to know about its own column to offer the split. */
export interface ColumnSplitControls {
  /** True when this pane's column already holds two rows. */
  split: boolean;
  /** False once the column is at its row cap, or the page is at its slot cap. */
  canSplit: boolean;
  onSplit(): void;
  onMerge(): void;
}

/**
 * Stacking is a per-column decision, so the button that makes it rides on the pane rather than in
 * the layout picker — with several columns on screen only the pane itself says which column a click
 * means. It is a toggle: a full-height column splits in two, a split one goes back to full height.
 *
 * Both panes of a split column carry the undo, and the top one is what survives it either way.
 */
export function ColumnSplitButton({ split, canSplit, onSplit, onMerge }: ColumnSplitControls) {
  if (split) {
    return (
      <button
        className="icon-button"
        type="button"
        onClick={onMerge}
        aria-label="열 분할 해제"
        title="열 분할 해제 (위쪽 패인이 열을 차지합니다)"
      >
        <Square size={13} />
      </button>
    );
  }
  return (
    <button
      className="icon-button"
      type="button"
      onClick={onSplit}
      disabled={!canSplit}
      aria-label="열 세로분할"
      title={
        canSplit
          ? "열 세로분할 (이 열만 위아래로 나눕니다)"
          : `열을 더 나눌 수 없습니다 (한 페이지 최대 ${MAX_LAYOUT_SLOTS}칸)`
      }
    >
      <SquareSplitVertical size={13} />
    </button>
  );
}

/**
 * The pane's top line: which folder this terminal is in, which branch, and whose work project it is.
 * A session name says nothing about where the session lives, and with twelve panes on a page that is
 * the one thing that tells two of them apart.
 *
 * No separators between the parts — the icons already mark the boundaries, so a part that shrinks
 * away under a narrow column cannot leave a stranded middot behind. Documents share this line
 * through their own header in WorkspaceGrid.
 */
export function PaneContextLine({ context }: { context: PaneContext | null }) {
  if (!context) return null;
  return (
    <div className="pane-context" title={context.title}>
      {context.tool ? <Wrench size={11} /> : <Folder size={11} />}
      <span className="pane-context-folder">{context.folder}</span>
      {context.branch ? (
        <span className="pane-context-branch">
          <GitBranch size={10} />
          <span>{context.branch}</span>
        </span>
      ) : null}
      {context.workProject ? (
        <span className="pane-context-project">
          <Briefcase size={10} />
          <span>{context.workProject}</span>
        </span>
      ) : null}
    </div>
  );
}

interface PaneHeaderProps {
  session: TerminalSessionView;
  label: string;
  /** Where this session lives. Null only while the registries are still loading. */
  context: PaneContext | null;
  agents: AgentView[];
  renaming: boolean;
  pendingAction: boolean;
  refreshing: boolean;
  /** A missing folder blocks resume until it is relinked; tool sessions never are. */
  resumeBlocked: boolean;
  /** This pane's column, and what splitting it would do. */
  columnSplit: ColumnSplitControls;
  onStartRename(): void;
  onRename(name: string | null): void;
  onCancelRename(): void;
  onResume(): void;
  onRefresh(): void;
  onStop(): void;
  /** Frees the slot for another session; this one keeps running and keeps its tab. */
  onClearSlot(): void;
  /** Ends the session and deletes its scrollback — asks first. The one irreversible button here. */
  onRemove(): void;
  onContextMenu(event: ReactMouseEvent): void;
}

/**
 * Session controls live on the pane, not in the workspace header: with several terminals on screen
 * only the pane itself says which session a button acts on.
 *
 * The header doubles as the pane's drag handle — dragging it onto another slot is how panes trade
 * places. Renaming turns the handle off so the name field can take a text selection.
 */
export function PaneHeader({
  session,
  label,
  context,
  agents,
  renaming,
  pendingAction,
  refreshing,
  resumeBlocked,
  columnSplit,
  onStartRename,
  onRename,
  onCancelRename,
  onResume,
  onRefresh,
  onStop,
  onClearSlot,
  onRemove,
  onContextMenu,
}: PaneHeaderProps) {
  const agent = findAgent(agents, session.kind);
  const finished = session.status === "exited" || session.status === "error";

  return (
    <header
      className={`pane-header ${context?.accentClass ?? ""}`.trim()}
      draggable={!renaming}
      onDragStart={(event) => startSessionDrag(event, session.id)}
      onContextMenu={onContextMenu}
    >
      <PaneContextLine context={context} />
      <div className="pane-header-main">
        <span
          className={`status-dot status-${session.status}`}
          title={statusLabels[session.status]}
          aria-label={statusLabels[session.status]}
        />
        {agent ? <AgentIcon agent={agent} size={13} className={agentAccentClass(agent)} /> : null}
        {renaming ? (
          <SessionNameInput initialName={label} onSubmit={onRename} onCancel={onCancelRename} />
        ) : (
          <span className="pane-title" title={label} onDoubleClick={onStartRename}>
            {label}
          </span>
        )}
        <div className="pane-actions">
          <ColumnSplitButton {...columnSplit} />
          {finished ? (
            <button
              className="icon-button"
              type="button"
              onClick={onResume}
              disabled={pendingAction || resumeBlocked}
              aria-label="세션 재개"
              title={resumeBlocked ? "재개하려면 먼저 폴더를 다시 연결하세요" : "세션 재개"}
            >
              <RotateCcw size={13} />
            </button>
          ) : null}
          <button
            className="icon-button"
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="세션 새로고침"
            title="세션 새로고침"
          >
            <RefreshCw className={refreshing ? "spin" : undefined} size={13} />
          </button>
          {!finished ? (
            <button
              className="icon-button"
              type="button"
              onClick={onStop}
              disabled={pendingAction}
              aria-label="세션 중지"
              title="세션 중지"
            >
              <CircleStop size={13} />
            </button>
          ) : null}
          {/* Deleting a session used to be reachable only by right-clicking this header. It sits out
              in the open now, next to the ✕ it is so often confused with — hence the danger tint. */}
          <button
            className="icon-button danger-button"
            type="button"
            onClick={onRemove}
            disabled={pendingAction}
            aria-label="세션 제거"
            title="세션 제거 (스크롤백까지 삭제)"
          >
            <Trash2 size={13} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={onClearSlot}
            aria-label="슬롯 비우기"
            title="슬롯 비우기 (세션은 유지)"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </header>
  );
}
