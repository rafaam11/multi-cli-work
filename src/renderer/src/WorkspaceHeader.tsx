import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalKind } from "@shared/terminal-types";
import { FolderOpen, LayoutGrid, MonitorDot, PanelsTopLeft } from "lucide-react";
import { AgentIcon, agentAccentClass } from "./brand-icons";
import { newSessionLabel, projectName, statusLabels } from "./session-labels";

interface WorkspaceHeaderProps {
  /** Set when one of the three workspaces is on screen; the folder controls step aside for it. */
  workspace: { index: number; paneCount: number; folderCount: number } | null;
  selectedProject: SharedProject | null;
  selectedSession: TerminalSessionView | null;
  selectedSessionLabel: string | null;
  projectMissing: boolean;
  agents: AgentView[];
  pendingAction: boolean;
  readOnly: boolean;
  /** Whether the 상세 page is what the workspace is already showing. */
  detailActive: boolean;
  onOpenDetail(): void;
  onStartSession(kind: TerminalKind): void;
  onRelinkProject(): void;
}

/**
 * The header names what is on screen and starts new work. Per-session controls live on the pane
 * headers instead — with a grid of terminals, only the pane itself says which session a button
 * would act on.
 *
 * A workspace holds panes from several folders at once, so there is no folder for 상세 to open and
 * no folder for a launcher to start a session in. Those controls are for folder surfaces only; the
 * workspace gets a title saying how much it holds and where from.
 */
export function WorkspaceHeader({
  workspace,
  selectedProject,
  selectedSession,
  selectedSessionLabel,
  projectMissing,
  agents,
  pendingAction,
  readOnly,
  detailActive,
  onOpenDetail,
  onStartSession,
  onRelinkProject,
}: WorkspaceHeaderProps) {
  const canLaunch = Boolean(selectedProject) && !projectMissing && !pendingAction;
  const title = workspace
    ? `작업공간${workspace.index + 1}`
    : selectedSession?.tool
      ? "도구"
      : selectedProject
        ? projectName(selectedProject)
        : "선택된 폴더 없음";
  const subtitle = workspace
    ? workspace.paneCount === 0
      ? "탭을 끌어다 놓아 이 작업공간을 채우세요"
      : `패인 ${workspace.paneCount}개 · 폴더 ${workspace.folderCount}곳`
    : selectedSession?.tool
      ? selectedSession.cwd
      : (selectedProject?.rootPath ?? "폴더를 열어 세션을 시작하세요");

  return (
    <header className="workspace-header">
      <div className="workspace-identity">
        {workspace ? <LayoutGrid size={16} aria-hidden="true" /> : <MonitorDot size={16} aria-hidden="true" />}
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
        {!workspace && selectedProject ? (
          <div className="launcher-row">
            {agents.map((agent) => (
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
                    : projectMissing
                      ? "세션을 시작하려면 먼저 폴더를 다시 연결하세요"
                      : newSessionLabel(agent)
                }
              >
                <AgentIcon agent={agent} size={15} className={agent.available ? agentAccentClass(agent) : undefined} />
                <span>{agent.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </header>
  );
}
