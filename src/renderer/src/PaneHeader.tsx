import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import { CircleStop, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { AgentIcon, agentAccentClass } from "./brand-icons";
import { SessionNameInput } from "./SessionNameInput";
import { startSessionDrag } from "./session-drag";
import { findAgent, statusLabels } from "./session-labels";

interface PaneHeaderProps {
  session: TerminalSessionView;
  label: string;
  agents: AgentView[];
  renaming: boolean;
  pendingAction: boolean;
  refreshing: boolean;
  /** A missing folder blocks resume until it is relinked; tool sessions never are. */
  resumeBlocked: boolean;
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
  agents,
  renaming,
  pendingAction,
  refreshing,
  resumeBlocked,
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
      className="pane-header"
      draggable={!renaming}
      onDragStart={(event) => startSessionDrag(event, session.id)}
      onContextMenu={onContextMenu}
    >
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
    </header>
  );
}
