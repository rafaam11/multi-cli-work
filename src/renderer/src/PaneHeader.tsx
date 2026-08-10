import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import { CircleStop, Grid2x2, RefreshCw, RotateCcw, X } from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { AgentIcon, agentAccentClass } from "./brand-icons";
import { SessionNameInput } from "./SessionNameInput";
import { findAgent, statusLabels } from "./session-labels";
import { useDismissable } from "./use-dismissable";

/** A session waiting behind the grid — what the +N menu offers to swap into this pane. */
export interface HiddenSessionCandidate {
  sessionId: string;
  label: string;
  /** Context shown dimmed: the folder (or "도구") the candidate belongs to. */
  detail: string | null;
}

interface PaneHeaderProps {
  session: TerminalSessionView;
  label: string;
  agents: AgentView[];
  renaming: boolean;
  pendingAction: boolean;
  refreshing: boolean;
  /** A missing folder blocks resume until it is relinked; tool sessions never are. */
  resumeBlocked: boolean;
  hiddenSessions: HiddenSessionCandidate[];
  onStartRename(): void;
  onRename(name: string | null): void;
  onCancelRename(): void;
  onResume(): void;
  onRefresh(): void;
  onStop(): void;
  onClosePane(): void;
  onSwap(sessionId: string): void;
  onContextMenu(event: ReactMouseEvent): void;
}

/**
 * Session controls live on the pane, not in the workspace header: with several terminals on screen
 * only the pane itself says which session a button acts on.
 */
export function PaneHeader({
  session,
  label,
  agents,
  renaming,
  pendingAction,
  refreshing,
  resumeBlocked,
  hiddenSessions,
  onStartRename,
  onRename,
  onCancelRename,
  onResume,
  onRefresh,
  onStop,
  onClosePane,
  onSwap,
  onContextMenu,
}: PaneHeaderProps) {
  const [swapMenuOpen, setSwapMenuOpen] = useState(false);
  const swapAnchor = useDismissable(() => setSwapMenuOpen(false));
  const agent = findAgent(agents, session.kind);
  const finished = session.status === "exited" || session.status === "error";

  return (
    <header className="pane-header" onContextMenu={onContextMenu}>
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
        {hiddenSessions.length > 0 ? (
          <div className="session-menu-anchor" ref={swapAnchor}>
            <button
              className="icon-button pane-swap-button"
              type="button"
              aria-label={`화면 밖 세션 ${hiddenSessions.length}개와 교체`}
              title={`화면 밖 세션 ${hiddenSessions.length}개와 교체`}
              aria-expanded={swapMenuOpen}
              aria-haspopup="menu"
              onClick={() => setSwapMenuOpen((open) => !open)}
            >
              +{hiddenSessions.length}
            </button>
            {swapMenuOpen ? (
              <div className="provider-menu" role="menu" aria-label="이 패인에 표시할 세션 선택">
                {hiddenSessions.map((candidate) => (
                  <button
                    key={candidate.sessionId}
                    type="button"
                    role="menuitem"
                    aria-label={candidate.label}
                    title={candidate.label}
                    onClick={() => {
                      setSwapMenuOpen(false);
                      onSwap(candidate.sessionId);
                    }}
                  >
                    <Grid2x2 size={15} />
                    <span>{candidate.label}</span>
                    {candidate.detail ? <span className="provider-unavailable">{candidate.detail}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <button
          className="icon-button"
          type="button"
          onClick={onClosePane}
          aria-label="패인 닫기"
          title="패인 닫기 (세션은 유지)"
        >
          <X size={13} />
        </button>
      </div>
    </header>
  );
}
