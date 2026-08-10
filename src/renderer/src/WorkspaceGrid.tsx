import type { AgentView } from "@shared/agent-types";
import { SHIFT_ENTER_BYTES } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { MouseEvent as ReactMouseEvent } from "react";
import { PaneHeader, type HiddenSessionCandidate } from "./PaneHeader";
import { TerminalPane, type TerminalCommands } from "./TerminalPane";
import { sessionLabel } from "./session-labels";

interface WorkspaceGridProps {
  /** The on-screen sessions, in pane order — at most six, resolved by the caller. */
  sessions: TerminalSessionView[];
  /** Every session, for label numbering among a pane's project peers. */
  allSessions: TerminalSessionView[];
  agents: AgentView[];
  /** The pane keyboard input goes to; panes surface it, clicking one moves it. */
  focusedSessionId: string | null;
  renamingSessionId: string | null;
  refreshRequests: Readonly<Record<string, number>>;
  refreshingSessionIds: ReadonlySet<string>;
  pendingAction: boolean;
  isProjectMissing(projectId: string | null): boolean;
  /** Sessions with no pane, most recently active first — every pane's +N swap menu. */
  hiddenSessions: HiddenSessionCandidate[];
  onAttached(session: TerminalSessionView): void;
  onRefreshComplete(sessionId: string): void;
  onError(message: string): void;
  onRegisterCommands(sessionId: string, commands: TerminalCommands | null): void;
  /** A terminal took the keyboard — the 편집 menu's target, not a selection change. */
  onTerminalFocused(sessionId: string): void;
  /** The user pressed inside this pane, which is what moves the focused-pane selection. */
  onFocusPane(sessionId: string): void;
  onResumeSession(session: TerminalSessionView): void;
  onRefreshSession(sessionId: string): void;
  onStopSession(session: TerminalSessionView): void;
  /** Removes the pane from the grid only — the session keeps running behind it. */
  onClosePane(sessionId: string): void;
  onSwapSession(paneSessionId: string, nextSessionId: string): void;
  onSessionContextMenu(session: TerminalSessionView, event: ReactMouseEvent): void;
  onStartRename(sessionId: string): void;
  onRenameSession(sessionId: string, name: string | null): void;
  onCancelRename(): void;
}

/**
 * The pane count alone decides the layout — 1 fills the view, 2 sit side by side, 3–4 take a 2×2,
 * 5–6 a 2×3 — so there is nothing to drag and nothing to persist beyond the session list itself.
 * Each pane keeps its own xterm, fit addon and resize reporting; the grid is pure layout.
 */
export function WorkspaceGrid({
  sessions,
  allSessions,
  agents,
  focusedSessionId,
  renamingSessionId,
  refreshRequests,
  refreshingSessionIds,
  pendingAction,
  isProjectMissing,
  hiddenSessions,
  onAttached,
  onRefreshComplete,
  onError,
  onRegisterCommands,
  onTerminalFocused,
  onFocusPane,
  onResumeSession,
  onRefreshSession,
  onStopSession,
  onClosePane,
  onSwapSession,
  onSessionContextMenu,
  onStartRename,
  onRenameSession,
  onCancelRename,
}: WorkspaceGridProps) {
  const shiftEnterBytes = (pane: TerminalSessionView): string | null =>
    SHIFT_ENTER_BYTES[agents.find((agent) => agent.id === pane.kind)?.shiftEnter ?? "enter"];
  const labelFor = (pane: TerminalSessionView): string =>
    sessionLabel(pane, allSessions.filter((peer) => peer.projectId === pane.projectId), agents);

  return (
    <div className="workspace-grid" data-panes={sessions.length}>
      {sessions.map((session) => (
        <section
          key={session.id}
          className={`grid-pane ${session.id === focusedSessionId ? "pane-focused" : ""}`}
          aria-label={labelFor(session)}
          onMouseDownCapture={() => {
            if (session.id !== focusedSessionId) onFocusPane(session.id);
          }}
        >
          <PaneHeader
            session={session}
            label={labelFor(session)}
            agents={agents}
            renaming={renamingSessionId === session.id}
            pendingAction={pendingAction}
            refreshing={refreshingSessionIds.has(session.id)}
            resumeBlocked={!session.tool && isProjectMissing(session.projectId)}
            hiddenSessions={hiddenSessions}
            onStartRename={() => onStartRename(session.id)}
            onRename={(name) => onRenameSession(session.id, name)}
            onCancelRename={onCancelRename}
            onResume={() => onResumeSession(session)}
            onRefresh={() => onRefreshSession(session.id)}
            onStop={() => onStopSession(session)}
            onClosePane={() => onClosePane(session.id)}
            onSwap={(nextSessionId) => onSwapSession(session.id, nextSessionId)}
            onContextMenu={(event) => onSessionContextMenu(session, event)}
          />
          <TerminalPane
            key={session.id}
            session={session}
            shiftEnterBytes={shiftEnterBytes(session)}
            refreshRequest={refreshRequests[session.id] ?? 0}
            autoFocus={session.id === focusedSessionId}
            onAttached={onAttached}
            onRefreshComplete={onRefreshComplete}
            onError={onError}
            onRegisterCommands={onRegisterCommands}
            onTerminalFocused={onTerminalFocused}
          />
        </section>
      ))}
    </div>
  );
}
