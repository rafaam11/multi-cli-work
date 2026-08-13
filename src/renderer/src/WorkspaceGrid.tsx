import type { AgentView } from "@shared/agent-types";
import { SHIFT_ENTER_BYTES } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import { Plus, X } from "lucide-react";
import { useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { canSplitColumn, columnOfSlot, type GridLayout } from "./grid-layouts";
import type { PaneContext } from "./pane-context";
import { DocumentPaneIcon, paneContentId, type PaneContent } from "./pane-items";
import { ColumnSplitButton, PaneContextLine, PaneHeader, type ColumnSplitControls } from "./PaneHeader";
import { TerminalPane, type TerminalCommands } from "./TerminalPane";
import { isSessionDrag, readSessionDrag, startSessionDrag } from "./session-drag";
import { sessionLabel } from "./session-labels";
import { resolveSnapZone, type SnapZone } from "./snap-zones";

interface WorkspaceGridProps {
  /** The arrangement to draw. It alone decides how many cells exist. */
  layout: GridLayout;
  /** One entry per slot the layout draws: a pane, or null for a slot left open as a drop target. */
  slots: (PaneContent | null)[];
  /** Every session, for label numbering among a pane's project peers. */
  allSessions: TerminalSessionView[];
  /** Where each pane lives, keyed by pane id — the grid never asks whether it is a session. */
  paneContexts: ReadonlyMap<string, PaneContext>;
  agents: AgentView[];
  /** The pane keyboard input goes to; panes surface it, clicking one moves it. */
  focusedPaneId: string | null;
  renamingSessionId: string | null;
  refreshRequests: Readonly<Record<string, number>>;
  pendingAction: boolean;
  isProjectMissing(projectId: string | null): boolean;
  onAttached(session: TerminalSessionView): void;
  onRefreshComplete(sessionId: string): void;
  onError(message: string): void;
  onRegisterCommands(sessionId: string, commands: TerminalCommands | null): void;
  /** A terminal took the keyboard — the 편집 menu's target, not a selection change. */
  onTerminalFocused(sessionId: string): void;
  /** The user pressed inside this pane, which is what moves the focused-pane selection. */
  onFocusPane(paneId: string): void;
  onResumeSession(session: TerminalSessionView): void;
  onStopSession(session: TerminalSessionView): void;
  /**
   * What ✕ means on this surface. A folder grid empties the slot; a shelf hands the pane to the
   * other shelf, because a grid that fills itself would only take an emptied slot back. Null leaves
   * the folder wording in place. Session and document panes read the same two strings.
   */
  clearAction: { label: string; title: string } | null;
  /** Empties the slot only — the session keeps running, the document stays open, both keep a tab. */
  onClearSlot(index: number): void;
  /** Gives this slot's column a second row; every other column keeps its full height. */
  onSplitColumn(index: number): void;
  /** Puts this slot's column back to one full-height pane. */
  onMergeColumn(index: number): void;
  /** Ends the session and deletes its scrollback right away — there is no confirmation step. */
  onRemoveSession(session: TerminalSessionView): void;
  /**
   * The empty slot's ＋ 새 세션 was pressed. The anchor is the button's own rect rather than the
   * pointer, so the list opens in the same place whether it was clicked or reached by keyboard.
   */
  onRequestNewSession(index: number, anchor: { x: number; y: number }): void;
  /** A pane was dropped on this slot: one from another slot, or a tab from the bar. */
  onDropPane(index: number, paneId: string): void;
  /** A pane was dropped on an edge or a corner: take the zone's preset and put the pane in its slot. */
  onSnapPane(zone: SnapZone, paneId: string): void;
  onSessionContextMenu(session: TerminalSessionView, event: ReactMouseEvent): void;
  onStartRename(sessionId: string): void;
  onRenameSession(sessionId: string, name: string | null): void;
  onCancelRename(): void;
}

/**
 * A grid of slots, not a list of panes. The layout hands over `grid-template-*` and every slot sits
 * in its own named area, so a pane's place is a property of the arrangement rather than of how many
 * sessions happen to be open. A slot holds a terminal or a document — the grid treats them alike.
 *
 * Panes are keyed by pane id: dragging one to another slot moves a `grid-area` and nothing more,
 * which is what keeps xterm from being torn down and re-attached on every rearrangement. Nothing
 * moves while a drag is in flight either — only the outline under the cursor changes — because a
 * pane changing size walks the whole xterm→PTY resize chain.
 */
export function WorkspaceGrid({
  layout,
  slots,
  allSessions,
  paneContexts,
  agents,
  focusedPaneId,
  renamingSessionId,
  refreshRequests,
  pendingAction,
  isProjectMissing,
  onAttached,
  onRefreshComplete,
  onError,
  onRegisterCommands,
  onTerminalFocused,
  onFocusPane,
  onResumeSession,
  onStopSession,
  clearAction,
  onClearSlot,
  onSplitColumn,
  onMergeColumn,
  onRemoveSession,
  onRequestNewSession,
  onDropPane,
  onSnapPane,
  onSessionContextMenu,
  onStartRename,
  onRenameSession,
  onCancelRename,
}: WorkspaceGridProps) {
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [snapZone, setSnapZone] = useState<SnapZone | null>(null);
  const shiftEnterBytes = (pane: TerminalSessionView): string | null =>
    SHIFT_ENTER_BYTES[agents.find((agent) => agent.id === pane.kind)?.shiftEnter ?? "enter"];
  const labelFor = (pane: TerminalSessionView): string =>
    sessionLabel(pane, allSessions.filter((peer) => peer.projectId === pane.projectId), agents);

  const slotProps = (index: number) => ({
    "data-slot": index,
    style: { gridArea: `s${index + 1}` },
    onDragOver: (event: ReactDragEvent) => {
      if (!isSessionDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dropIndex !== index) setDropIndex(index);
    },
    onDragLeave: (event: ReactDragEvent) => {
      // Crossing into a child fires dragleave too; only a real exit clears the outline.
      const next = event.relatedTarget as Node | null;
      if (next && event.currentTarget.contains(next)) return;
      setDropIndex((current) => (current === index ? null : current));
    },
    onDrop: (event: ReactDragEvent) => {
      if (!isSessionDrag(event)) return;
      event.preventDefault();
      setDropIndex(null);
      setSnapZone(null);
      const paneId = readSessionDrag(event);
      if (!paneId) return;
      // The edge wins over the slot beneath it: the cursor is there on purpose, and the region it
      // asks for is bigger than any one slot.
      if (snapZone) onSnapPane(snapZone, paneId);
      else onDropPane(index, paneId);
    },
  });

  /**
   * The slot handlers run first and the grid's own runs after, so this is where the two indicators
   * are reconciled: over an edge, only the snap preview shows.
   */
  const trackSnapZone = (event: ReactDragEvent) => {
    if (!isSessionDrag(event)) return;
    const zone = resolveSnapZone(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY);
    setSnapZone((current) => (current?.id === zone?.id ? current : zone));
    if (zone) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropIndex(null);
    }
  };

  const endDrag = () => {
    setDropIndex(null);
    setSnapZone(null);
  };

  /**
   * A slot's own column, in the terms the header button needs. The layout already records how tall
   * each column is, so nothing here has to count panes. Empty slots get no button — a column with
   * nothing in it is not one anybody wants to split further.
   */
  const columnSplitFor = (index: number): ColumnSplitControls => ({
    split: (columnOfSlot(layout.columnRows, index)?.rows ?? 1) > 1,
    canSplit: canSplitColumn(layout, index),
    onSplit: () => onSplitColumn(index),
    onMerge: () => onMergeColumn(index),
  });

  const paneClass = (paneId: string, index: number, extra?: string): string =>
    ["grid-pane", extra ?? "", paneId === focusedPaneId ? "pane-focused" : "", dropIndex === index ? "drop-target" : ""]
      .filter(Boolean)
      .join(" ");

  return (
    <div
      className="workspace-grid"
      data-layout={layout.id}
      data-slots={layout.slots}
      style={{
        gridTemplateColumns: layout.columns,
        gridTemplateRows: layout.rows,
        gridTemplateAreas: layout.areas,
      }}
      onDragOver={trackSnapZone}
      onDragLeave={(event) => {
        // The grid is one drop surface: crossing between its own slots is not leaving it.
        const next = event.relatedTarget as Node | null;
        if (next && event.currentTarget.contains(next)) return;
        setSnapZone(null);
      }}
      onDrop={endDrag}
      onDragEnd={endDrag}
    >
      {snapZone ? (
        <div
          className="snap-preview"
          data-zone={snapZone.id}
          aria-hidden="true"
          style={{
            left: `${snapZone.rect.left * 100}%`,
            top: `${snapZone.rect.top * 100}%`,
            width: `${snapZone.rect.width * 100}%`,
            height: `${snapZone.rect.height * 100}%`,
          }}
        >
          <span>{snapZone.label}</span>
        </div>
      ) : null}
      {slots.map((item, index) => {
        if (!item) {
          return (
            <div
              key={`slot-${index}`}
              {...slotProps(index)}
              className={`grid-slot empty ${dropIndex === index ? "drop-target" : ""}`.trim()}
              aria-label={`빈 슬롯 ${index + 1} — 세션을 시작하거나 끌어다 놓기`}
            >
              <span className="grid-slot-number">{index + 1}</span>
              <button
                type="button"
                className="grid-slot-new-session"
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  onRequestNewSession(index, { x: rect.left, y: rect.bottom + 4 });
                }}
              >
                <Plus size={14} />
                <span>새 세션</span>
              </button>
              {/* The slot is still a drop target, and losing that line would be the only sign of it. */}
              <span className="grid-slot-hint">세션 탭을 끌어다 놓기</span>
            </div>
          );
        }

        const paneId = paneContentId(item);
        if (item.kind === "document") {
          const { document, content } = item;
          return (
            <section
              key={paneId}
              {...slotProps(index)}
              className={paneClass(paneId, index, "grid-pane-document")}
              aria-label={document.label}
              onMouseDownCapture={() => {
                if (paneId !== focusedPaneId) onFocusPane(paneId);
              }}
            >
              <header
                className={`pane-header ${paneContexts.get(paneId)?.accentClass ?? ""}`.trim()}
                draggable
                onDragStart={(event) => startSessionDrag(event, paneId)}
              >
                {/* The document's own `detail` used to sit at the end of this row saying the same
                    folder the context line now says, one line up. */}
                <PaneContextLine context={paneContexts.get(paneId) ?? null} />
                <div className="pane-header-main">
                  <DocumentPaneIcon kind={document.kind} />
                  <span className="pane-title" title={document.label}>
                    {document.label}
                  </span>
                  {document.dirty ? <span className="pane-dirty" title="저장하지 않은 변경" /> : null}
                  <div className="pane-actions">
                    <ColumnSplitButton {...columnSplitFor(index)} />
                    <button
                      className="icon-button"
                      type="button"
                      onClick={() => onClearSlot(index)}
                      aria-label={clearAction?.label ?? "슬롯 비우기"}
                      title={clearAction?.title ?? "슬롯 비우기 (문서는 탭에 남습니다)"}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              </header>
              <div className="grid-pane-body">{content}</div>
            </section>
          );
        }

        const session = item.session;
        return (
          <section
            key={paneId}
            {...slotProps(index)}
            className={paneClass(paneId, index, `status-${session.status}`)}
            aria-label={labelFor(session)}
            onMouseDownCapture={() => {
              if (paneId !== focusedPaneId) onFocusPane(paneId);
            }}
          >
            <PaneHeader
              session={session}
              label={labelFor(session)}
              context={paneContexts.get(paneId) ?? null}
              agents={agents}
              renaming={renamingSessionId === session.id}
              pendingAction={pendingAction}
              resumeBlocked={!session.tool && isProjectMissing(session.projectId)}
              columnSplit={columnSplitFor(index)}
              clearAction={clearAction}
              onStartRename={() => onStartRename(session.id)}
              onRename={(name) => onRenameSession(session.id, name)}
              onCancelRename={onCancelRename}
              onResume={() => onResumeSession(session)}
              onStop={() => onStopSession(session)}
              onClearSlot={() => onClearSlot(index)}
              onRemove={() => onRemoveSession(session)}
              onContextMenu={(event) => onSessionContextMenu(session, event)}
            />
            <TerminalPane
              session={session}
              shiftEnterBytes={shiftEnterBytes(session)}
              refreshRequest={refreshRequests[session.id] ?? 0}
              autoFocus={paneId === focusedPaneId}
              onAttached={onAttached}
              onRefreshComplete={onRefreshComplete}
              onError={onError}
              onRegisterCommands={onRegisterCommands}
              onTerminalFocused={onTerminalFocused}
            />
          </section>
        );
      })}
    </div>
  );
}
