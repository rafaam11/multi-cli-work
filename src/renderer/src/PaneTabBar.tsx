import type { AgentId, AgentView } from "@shared/agent-types";
import type { TerminalStatus } from "@shared/terminal-types";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AgentIcon, agentAccentClass } from "./brand-icons";
import { DocumentPaneIcon, type DocumentKind } from "./pane-items";
import { findAgent, statusLabels } from "./session-labels";
import { startSessionDrag } from "./session-drag";

interface TabBase {
  /** The pane id: a session id, or a document id. */
  id: string;
  label: string;
  /** The folder a pane belongs to, shown only where tabs come from several — a workspace. */
  detail: string | null;
  /** False while the pane sits on another page; the tab dims to say so. */
  onScreen: boolean;
}

export type ViewTab =
  | (TabBase & { kind: "session"; status: TerminalStatus; agent: AgentId })
  | (TabBase & { kind: "document"; document: DocumentKind; dirty: boolean });

interface PaneTabBarProps {
  tabs: ViewTab[];
  agents: AgentView[];
  /** The pane that has focus — the one tab drawn as current. */
  activePaneId: string | null;
  page: number;
  pageCount: number;
  onSelect(paneId: string): void;
  onPageChange(page: number): void;
}

/**
 * Everything a view can show, on one line above the grid: terminals and the documents opened beside
 * them. Panes come and go with the layout and the page, so the tab bar is the only place that always
 * lists them all — clicking a tab is how a pane off the current page gets back on screen, and
 * dragging one is how it joins a slot or a workspace.
 *
 * Tabs keep the order the caller hands over (creation order for a folder, slot order for a
 * workspace) so they do not rearrange themselves as sessions change status.
 */
export function PaneTabBar({ tabs, agents, activePaneId, page, pageCount, onSelect, onPageChange }: PaneTabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="session-tab-bar">
      <div className="session-tabs" role="tablist" aria-label="패인 탭">
        {tabs.map((tab) => {
          const agent = tab.kind === "session" ? findAgent(agents, tab.agent) : null;
          const state = tab.kind === "session" ? statusLabels[tab.status] : "문서";
          const title = `${tab.label}${tab.detail ? ` · ${tab.detail}` : ""} — ${state}`;
          return (
            <button
              key={tab.id}
              className={["session-tab", tab.id === activePaneId ? "current" : "", tab.onScreen ? "" : "offscreen"]
                .filter(Boolean)
                .join(" ")}
              type="button"
              role="tab"
              aria-selected={tab.id === activePaneId}
              title={title}
              draggable
              onDragStart={(event) => startSessionDrag(event, tab.id)}
              onClick={() => onSelect(tab.id)}
            >
              {tab.kind === "session" ? (
                <>
                  <span
                    className={`status-dot status-${tab.status}`}
                    aria-label={statusLabels[tab.status]}
                    title={statusLabels[tab.status]}
                  />
                  {agent ? <AgentIcon agent={agent} size={12} className={agentAccentClass(agent)} /> : null}
                </>
              ) : (
                <DocumentPaneIcon kind={tab.document} size={12} />
              )}
              <span className="session-tab-label">{tab.label}</span>
              {tab.kind === "document" && tab.dirty ? (
                <span className="pane-dirty" title="저장하지 않은 변경" aria-label="저장하지 않은 변경" />
              ) : null}
              {tab.detail ? <span className="session-tab-detail">{tab.detail}</span> : null}
            </button>
          );
        })}
      </div>
      {pageCount > 1 ? (
        <div className="session-tab-pages">
          <button
            className="icon-button"
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 0}
            aria-label="이전 페이지"
            title="이전 페이지"
          >
            <ChevronLeft size={13} />
          </button>
          <span className="session-tab-page-count" aria-label={`${pageCount}페이지 중 ${page + 1}페이지`}>
            {page + 1}/{pageCount}
          </span>
          <button
            className="icon-button"
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount - 1}
            aria-label="다음 페이지"
            title="다음 페이지"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
