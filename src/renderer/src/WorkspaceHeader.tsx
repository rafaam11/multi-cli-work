import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalKind, ToolCommand } from "@shared/terminal-types";
import { CircleStop, Columns2, FolderOpen, MonitorDot, Plus, RefreshCw, RotateCcw, Trash2, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentIcon, agentAccentClass } from "./brand-icons";
import {
  TOOL_AGENT_ID,
  agentLabel,
  findAgent,
  newSessionLabel,
  projectName,
  statusLabels,
  toolDetails,
} from "./session-labels";

const TOOL_COMMANDS: ToolCommand[] = ["claude-update", "codex-update"];

export interface SplitCandidate {
  sessionId: string;
  label: string;
  /** Context shown dimmed: the folder (or "도구") the candidate belongs to. */
  detail: string | null;
}

interface WorkspaceHeaderProps {
  selectedProject: SharedProject | null;
  selectedSession: TerminalSessionView | null;
  selectedSessionLabel: string | null;
  projectMissing: boolean;
  agents: AgentView[];
  pendingAction: boolean;
  refreshing: boolean;
  readOnly: boolean;
  splitActive: boolean;
  splitCandidates: SplitCandidate[];
  onSplit(sessionId: string | null): void;
  onStartSession(kind: TerminalKind): void;
  onStartTool(tool: ToolCommand): void;
  onEditAgents(): void;
  onResumeSession(): void;
  onRefreshSession(): void;
  onStopSession(): void;
  onRemoveSession(): void;
  onRelinkProject(): void;
}

function useDismissable(onDismiss: () => void) {
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!anchor.current?.contains(event.target as Node)) onDismiss();
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [onDismiss]);
  return anchor;
}

export function WorkspaceHeader({
  selectedProject,
  selectedSession,
  selectedSessionLabel,
  projectMissing,
  agents,
  pendingAction,
  refreshing,
  readOnly,
  splitActive,
  splitCandidates,
  onSplit,
  onStartSession,
  onStartTool,
  onEditAgents,
  onResumeSession,
  onRefreshSession,
  onStopSession,
  onRemoveSession,
  onRelinkProject,
}: WorkspaceHeaderProps) {
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const toolsAnchor = useDismissable(() => setToolsMenuOpen(false));
  const [splitMenuOpen, setSplitMenuOpen] = useState(false);
  const splitAnchor = useDismissable(() => setSplitMenuOpen(false));

  const finished = selectedSession?.status === "exited" || selectedSession?.status === "error";
  const canLaunch = Boolean(selectedProject) && !projectMissing && !pendingAction;
  const title = selectedSession?.tool
    ? "도구"
    : selectedProject
      ? projectName(selectedProject)
      : "선택된 폴더 없음";
  const subtitle = selectedSession?.tool
    ? selectedSession.cwd
    : (selectedProject?.rootPath ?? "폴더를 열어 세션을 시작하세요");

  return (
    <header className="workspace-header">
      <div className="workspace-identity">
        <MonitorDot size={16} aria-hidden="true" />
        <div className="workspace-copy">
          <span className="workspace-title">
            {title}
            {selectedSession ? (
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
        {selectedSession ? (
          <span className={`active-status status-${selectedSession.status}`}>
            <span className={`status-dot status-${selectedSession.status}`} aria-hidden="true" />
            {statusLabels[selectedSession.status]}
          </span>
        ) : null}
        {selectedProject && !selectedSession?.tool ? (
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
        {selectedSession && finished ? (
          <button
            className="command-button"
            type="button"
            onClick={onResumeSession}
            disabled={pendingAction || (projectMissing && !selectedSession.tool)}
            aria-label="세션 재개"
            title={projectMissing && !selectedSession.tool ? "재개하려면 먼저 폴더를 다시 연결하세요" : "세션 재개"}
          >
            <RotateCcw size={14} />
            <span>재개</span>
          </button>
        ) : null}
        {selectedSession ? (
          <button
            className="icon-button"
            type="button"
            onClick={onRefreshSession}
            disabled={refreshing}
            aria-label="세션 새로고침"
            title="세션 새로고침"
          >
            <RefreshCw className={refreshing ? "spin" : undefined} size={15} />
          </button>
        ) : null}
        {selectedSession && !finished ? (
          <button
            className="icon-button"
            type="button"
            onClick={onStopSession}
            disabled={pendingAction}
            aria-label="세션 중지"
            title="세션 중지"
          >
            <CircleStop size={15} />
          </button>
        ) : null}
        {selectedSession ? (
          <button
            className="icon-button danger-button"
            type="button"
            onClick={onRemoveSession}
            disabled={pendingAction}
            aria-label="세션 제거"
            title="세션 제거"
          >
            <Trash2 size={15} />
          </button>
        ) : null}

        {/* An active split toggles off with one press; starting one asks which session fills the
            second pane. Two panes only. */}
        {selectedSession ? (
          <div className="session-menu-anchor" ref={splitAnchor}>
            <button
              className="icon-button"
              type="button"
              aria-label={splitActive ? "분할 해제" : "화면 분할"}
              title={
                splitActive
                  ? "분할 해제"
                  : splitCandidates.length === 0
                    ? "분할할 다른 세션이 없습니다"
                    : "화면 분할"
              }
              disabled={!splitActive && splitCandidates.length === 0}
              aria-expanded={splitMenuOpen}
              aria-haspopup="menu"
              onClick={() => {
                if (splitActive) onSplit(null);
                else setSplitMenuOpen((open) => !open);
              }}
            >
              <Columns2 size={15} />
            </button>
            {splitMenuOpen ? (
              <div className="provider-menu" role="menu" aria-label="분할할 세션 선택">
                {splitCandidates.map((candidate) => (
                  <button
                    key={candidate.sessionId}
                    type="button"
                    role="menuitem"
                    aria-label={candidate.label}
                    title={candidate.label}
                    onClick={() => {
                      setSplitMenuOpen(false);
                      onSplit(candidate.sessionId);
                    }}
                  >
                    <Columns2 size={15} />
                    <span>{candidate.label}</span>
                    {candidate.detail ? <span className="provider-unavailable">{candidate.detail}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* The launchers stay out in the open whether or not the folder already has sessions. */}
        {selectedProject ? (
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

        {/* Updating a CLI is not folder work, so this menu stays usable with no folder open. */}
        <div className="session-menu-anchor" ref={toolsAnchor}>
          <button
            className="icon-button"
            type="button"
            aria-label="도구"
            title="도구"
            aria-expanded={toolsMenuOpen}
            aria-haspopup="menu"
            onClick={() => setToolsMenuOpen((open) => !open)}
          >
            <Wrench size={15} />
          </button>
          {toolsMenuOpen ? (
            <div className="provider-menu" role="menu">
              {TOOL_COMMANDS.map((tool) => {
                const details = toolDetails[tool];
                const agentId = TOOL_AGENT_ID[tool];
                const installed = Boolean(findAgent(agents, agentId)?.available);
                return (
                  <button
                    key={tool}
                    type="button"
                    role="menuitem"
                    disabled={!installed || pendingAction}
                    onClick={() => {
                      setToolsMenuOpen(false);
                      onStartTool(tool);
                    }}
                    aria-label={details.menuLabel}
                    title={installed ? details.menuLabel : `${agentLabel(agents, agentId)} 미설치`}
                  >
                    <Wrench size={15} />
                    <span>{details.menuLabel}</span>
                    {!installed ? <span className="provider-unavailable">사용 불가</span> : null}
                  </button>
                );
              })}
              {/* Adding an agent means editing a file, so it belongs with the other config actions
                  rather than competing with the agents themselves for room in the launcher row. */}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setToolsMenuOpen(false);
                  onEditAgents();
                }}
                aria-label="에이전트 추가"
                title="agents.json을 편집기로 엽니다"
              >
                <Plus size={15} />
                <span>에이전트 추가</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
