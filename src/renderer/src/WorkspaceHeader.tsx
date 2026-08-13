import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalKind } from "@shared/terminal-types";
import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  FolderOpen,
  LayoutGrid,
  MonitorDot,
  PanelsTopLeft,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { AgentIcon, agentAccentClass } from "./brand-icons";
import { isAutoLayout } from "./grid-layouts";
import { LayoutPicker } from "./LayoutPicker";
import { newSessionLabel, projectName, statusLabels } from "./session-labels";
import { SHELF_TEXT, type ShelfKind } from "./shelves";

interface WorkspaceHeaderProps {
  /** Set when a shelf is on screen rather than a folder; the folder controls step aside for it. */
  workspace: { kind: ShelfKind; paneCount: number; folderCount: number } | null;
  /**
   * The grid's arrangement, or null on a surface that has no grid to arrange. The picker rides here
   * rather than above the grid so choosing a layout costs no terminal height.
   */
  layout: { layoutId: string; paneCount: number; onSelect(layoutId: string): void } | null;
  /**
   * Which page of the arrangement is showing. Panes that do not fit the layout paginate rather than
   * disappear, so this row is the only way back to them — it rides beside the picker that decides
   * how many fit in the first place.
   */
  pages: { page: number; count: number; onChange(page: number): void } | null;
  /**
   * Redrawing every pane on screen, or null on a surface with no panes to redraw. Refreshing is a
   * property of the window rather than of a session — every pane rebuilds its terminal against the
   * size it now has — so one button here replaces the one each pane header used to carry.
   */
  refreshAll: { count: number; busy: boolean; onRefresh(): void } | null;
  selectedProject: SharedProject | null;
  selectedSession: TerminalSessionView | null;
  selectedSessionLabel: string | null;
  /**
   * The session in the pane that has the focus, wherever that pane came from. `selectedSession`
   * belongs to the folder on screen and is null on a shelf, which holds panes from several — so
   * the 제거 button follows the focus instead, and works on both surfaces. The launchers do the
   * same on a shelf: with no folder of its own, the focused pane's path is what "here" means, and
   * `launchDisabledReason` says why that path cannot start anything right now.
   */
  focusedSession: { session: TerminalSessionView; label: string; launchDisabledReason: string | null } | null;
  onRemoveSession(session: TerminalSessionView): void;
  projectMissing: boolean;
  agents: AgentView[];
  pendingAction: boolean;
  readOnly: boolean;
  /** Whether the 상세 page is what the workspace is already showing. */
  detailActive: boolean;
  onOpenDetail(): void;
  onStartSession(kind: TerminalKind): void;
  /**
   * Opens the recent-folders launcher under the button. `자동` has no empty slots to press — the
   * arrangement closes every gap — so on that layout this is the only way in to the list.
   */
  onRequestNewSession(anchor: { x: number; y: number }): void;
  onRelinkProject(): void;
}

/**
 * The header names what is on screen and starts new work. Per-session controls live on the pane
 * headers instead — with a grid of terminals, only the pane itself says which session a button
 * would act on.
 *
 * A shelf holds panes from several folders at once, so there is no folder for 상세 to open. That
 * control is for folder surfaces only; a shelf gets a title saying how much it holds and where from.
 * The launchers do follow it there, aimed at the focused pane's path — see `focusedSession`.
 */
export function WorkspaceHeader({
  workspace,
  layout,
  pages,
  refreshAll,
  selectedProject,
  selectedSession,
  selectedSessionLabel,
  focusedSession,
  onRemoveSession,
  projectMissing,
  agents,
  pendingAction,
  readOnly,
  detailActive,
  onOpenDetail,
  onStartSession,
  onRequestNewSession,
  onRelinkProject,
}: WorkspaceHeaderProps) {
  /**
   * A folder surface launches into the folder it is showing; a shelf launches into whichever pane
   * holds the focus, since that is the only path on screen that belongs to anything.
   */
  const showsAgentLaunchers = workspace ? focusedSession !== null : selectedProject !== null;
  const launchDisabledReason = workspace
    ? focusedSession?.launchDisabledReason ?? null
    : projectMissing
      ? "세션을 시작하려면 먼저 폴더를 다시 연결하세요"
      : pendingAction
        ? "다른 작업이 끝난 뒤에 시작할 수 있습니다"
        : null;
  const canLaunch = showsAgentLaunchers && launchDisabledReason === null;
  /** Where a launched session lands, in words — the launchers' tooltip on a shelf says so. */
  const launchTargetLabel = workspace ? focusedSession?.label ?? null : null;
  const showsNewSessionButton = layout !== null && isAutoLayout(layout.layoutId);
  const title = workspace
    ? SHELF_TEXT[workspace.kind].name
    : selectedSession?.tool
      ? "도구"
      : selectedProject
        ? projectName(selectedProject)
        : "선택된 폴더 없음";
  const subtitle = workspace
    ? workspace.paneCount === 0
      ? SHELF_TEXT[workspace.kind].subtitle
      : `패인 ${workspace.paneCount}개 · 폴더 ${workspace.folderCount}곳`
    : selectedSession?.tool
      ? selectedSession.cwd
      : (selectedProject?.rootPath ?? "폴더를 열어 세션을 시작하세요");

  return (
    <header className="workspace-header">
      <div className="workspace-identity">
        {/* The two shelves take different icons: with the same title bar for both, the mark is what
            says at a glance which of them is on screen. */}
        {workspace?.kind === "hidden" ? (
          <EyeOff size={16} aria-hidden="true" />
        ) : workspace ? (
          <LayoutGrid size={16} aria-hidden="true" />
        ) : (
          <MonitorDot size={16} aria-hidden="true" />
        )}
        <div className="workspace-copy">
          <span className="workspace-title">
            {title}
            {!workspace && selectedSession ? (
              <>
                <span className="breadcrumb-separator">/</span>
                {selectedSessionLabel}
              </>
            ) : null}
          </span>
          <span className="workspace-path" title={subtitle}>
            {subtitle}
          </span>
        </div>
      </div>

      <div className="workspace-actions">
        {/* A shelf hides the folder controls, so on that surface the picker is the whole row. */}
        {layout ? (
          <LayoutPicker layoutId={layout.layoutId} paneCount={layout.paneCount} onSelect={layout.onSelect} />
        ) : null}
        {pages && pages.count > 1 ? (
          <div className="workspace-page-nav">
            <button
              className="icon-button"
              type="button"
              onClick={() => pages.onChange(pages.page - 1)}
              disabled={pages.page <= 0}
              aria-label="이전 페이지"
              title="이전 페이지"
            >
              <ChevronLeft size={13} />
            </button>
            <span className="workspace-page-count" aria-label={`${pages.count}페이지 중 ${pages.page + 1}페이지`}>
              {pages.page + 1}/{pages.count}
            </span>
            <button
              className="icon-button"
              type="button"
              onClick={() => pages.onChange(pages.page + 1)}
              disabled={pages.page >= pages.count - 1}
              aria-label="다음 페이지"
              title="다음 페이지"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        ) : null}
        {refreshAll ? (
          <button
            className="icon-button"
            type="button"
            onClick={refreshAll.onRefresh}
            disabled={refreshAll.busy || refreshAll.count === 0}
            aria-label="화면 새로고침"
            title={
              refreshAll.count === 0
                ? "새로고침할 세션이 없습니다"
                : `화면에 보이는 세션 ${refreshAll.count}개 새로고침`
            }
          >
            <RefreshCw className={refreshAll.busy ? "spin" : undefined} size={13} />
          </button>
        ) : null}
        {workspace ? null : selectedSession ? (
          <span className={`active-status status-${selectedSession.status}`}>
            <span className={`status-dot status-${selectedSession.status}`} aria-hidden="true" />
            {statusLabels[selectedSession.status]}
          </span>
        ) : null}
        {!workspace && selectedProject && !selectedSession?.tool ? (
          <button
            className="icon-button"
            type="button"
            onClick={onRelinkProject}
            disabled={readOnly}
            aria-label="폴더 다시 연결"
            title="폴더 다시 연결"
          >
            <FolderOpen size={15} />
          </button>
        ) : null}

        {/* Opening a folder goes straight to its terminals, so the 상세 page needs its own way in. */}
        {!workspace && selectedProject ? (
          <button
            className="command-button"
            type="button"
            onClick={onOpenDetail}
            disabled={detailActive}
            aria-label="폴더 상세"
            title="폴더 상세"
          >
            <PanelsTopLeft size={14} />
            <span>상세</span>
          </button>
        ) : null}

        {/* The launchers stay out in the open whether or not the folder already has sessions. */}
        {showsAgentLaunchers || showsNewSessionButton ? (
          <div className="launcher-row">
            {showsAgentLaunchers
              ? agents.map((agent) => (
                  <button
                    key={agent.id}
                    className="launcher-button"
                    type="button"
                    disabled={!canLaunch || !agent.available}
                    onClick={() => onStartSession(agent.id)}
                    aria-label={newSessionLabel(agent)}
                    title={
                      !agent.available
                        ? `${agent.label} 미설치`
                        : (launchDisabledReason ??
                          (launchTargetLabel
                            ? `${launchTargetLabel}와 같은 경로에서 ${agent.label} 시작`
                            : newSessionLabel(agent)))
                    }
                  >
                    <AgentIcon
                      agent={agent}
                      size={15}
                      className={agent.available ? agentAccentClass(agent) : undefined}
                    />
                    <span>{agent.label}</span>
                  </button>
                ))
              : null}
            {/* The list of recent folders, for starting somewhere other than what is on screen. */}
            {showsNewSessionButton ? (
              <button
                className="launcher-button"
                type="button"
                disabled={pendingAction}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  onRequestNewSession({ x: rect.left, y: rect.bottom + 4 });
                }}
                aria-label="최근 폴더에서 새 세션"
                title="최근 폴더에서 새 세션"
              >
                <Plus size={15} />
                <span>새 세션</span>
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Last in the row and on its own: the only control here that destroys anything. */}
        {focusedSession ? (
          <button
            className="icon-button danger-button"
            type="button"
            onClick={() => onRemoveSession(focusedSession.session)}
            disabled={pendingAction}
            aria-label={`${focusedSession.label} 세션 제거`}
            title={`${focusedSession.label} 세션 제거 (스크롤백까지 삭제)`}
          >
            <Trash2 size={15} />
          </button>
        ) : null}
      </div>
    </header>
  );
}
