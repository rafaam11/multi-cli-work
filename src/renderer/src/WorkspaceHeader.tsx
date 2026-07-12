import type { ProviderAvailability, TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalKind, ToolCommand } from "@shared/terminal-types";
import { CircleStop, FolderOpen, MonitorDot, RotateCcw, Trash2, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { projectName, providerDetails, statusLabels, toolDetails } from "./session-labels";

const TERMINAL_KINDS: TerminalKind[] = ["powershell", "claude", "codex"];
const TOOL_COMMANDS: ToolCommand[] = ["claude-update", "codex-update"];
const TOOL_PROVIDER: Record<ToolCommand, TerminalKind> = {
  "claude-update": "claude",
  "codex-update": "codex",
};

interface WorkspaceHeaderProps {
  selectedProject: SharedProject | null;
  selectedSession: TerminalSessionView | null;
  selectedSessionLabel: string | null;
  projectMissing: boolean;
  availability: ProviderAvailability;
  pendingAction: boolean;
  readOnly: boolean;
  onStartSession(kind: TerminalKind): void;
  onStartTool(tool: ToolCommand): void;
  onResumeSession(): void;
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
  availability,
  pendingAction,
  readOnly,
  onStartSession,
  onStartTool,
  onResumeSession,
  onStopSession,
  onRemoveSession,
  onRelinkProject,
}: WorkspaceHeaderProps) {
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const toolsAnchor = useDismissable(() => setToolsMenuOpen(false));

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

        {/* The launchers stay out in the open whether or not the folder already has sessions. */}
        {selectedProject ? (
          <div className="launcher-row">
            {TERMINAL_KINDS.map((kind) => {
              const details = providerDetails[kind];
              const ProviderIcon = details.icon;
              return (
                <button
                  key={kind}
                  className="launcher-button"
                  type="button"
                  disabled={!canLaunch || !availability[kind]}
                  onClick={() => onStartSession(kind)}
                  aria-label={details.menuLabel}
                  title={
                    !availability[kind]
                      ? `${details.label} 미설치`
                      : projectMissing
                        ? "세션을 시작하려면 먼저 폴더를 다시 연결하세요"
                        : details.menuLabel
                  }
                >
                  <ProviderIcon size={15} />
                  <span>{details.label}</span>
                </button>
              );
            })}
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
                const installed = availability[TOOL_PROVIDER[tool]];
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
                    title={installed ? details.menuLabel : `${providerDetails[TOOL_PROVIDER[tool]].label} 미설치`}
                  >
                    <Wrench size={15} />
                    <span>{details.menuLabel}</span>
                    {!installed ? <span className="provider-unavailable">사용 불가</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
