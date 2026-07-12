import type { ProjectWorkspaceSnapshot, TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderX,
  RefreshCw,
  SquareTerminal,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { ProjectMetadataEditor } from "./ProjectMetadataEditor";
import { UpdateBadge } from "./UpdateBadge";
import { projectName, providerDetails, sessionLabel, statusLabels } from "./session-labels";

interface ProjectSidebarProps {
  snapshot: ProjectWorkspaceSnapshot | null;
  projects: SharedProject[];
  sessions: TerminalSessionView[];
  toolSessions: TerminalSessionView[];
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  expandedProjects: Set<string>;
  editingProjectId: string | null;
  renamingSessionId: string | null;
  loading: boolean;
  loadError: string | null;
  onReload(): void;
  onAddProject(): void;
  onSelectProject(projectId: string): void;
  onSelectSession(session: TerminalSessionView): void;
  onToggleProject(projectId: string): void;
  onProjectContextMenu(project: SharedProject, event: ReactMouseEvent): void;
  onSessionContextMenu(session: TerminalSessionView, event: ReactMouseEvent): void;
  onRenameSession(sessionId: string, name: string | null): void;
  onCancelRename(): void;
  onProjectSaved(project: SharedProject): void;
  onCloseEditor(): void;
  onRestoreBackup(): void;
  isHome: boolean;
  onOpenHome(): void;
}

/**
 * Sessions keep the order they were created in. Sorting by updatedAt would shuffle the tree every
 * time a session emitted a status change, so merely opening one would jump it to the top.
 */
function byCreation(left: TerminalSessionView, right: TerminalSessionView): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function SessionNameInput({
  initialName,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  onSubmit(name: string | null): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initialName);
  return (
    <form
      className="session-rename"
      aria-label="세션 이름 변경"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value.trim() === "" ? null : value.trim());
      }}
    >
      <input
        type="text"
        aria-label="세션 이름"
        value={value}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        onBlur={onCancel}
      />
    </form>
  );
}

export function ProjectSidebar({
  snapshot,
  projects,
  sessions,
  toolSessions,
  selectedProjectId,
  selectedSessionId,
  expandedProjects,
  editingProjectId,
  renamingSessionId,
  loading,
  loadError,
  onReload,
  onAddProject,
  onSelectProject,
  onSelectSession,
  onToggleProject,
  onProjectContextMenu,
  onSessionContextMenu,
  onRenameSession,
  onCancelRename,
  onProjectSaved,
  onCloseEditor,
  onRestoreBackup,
  isHome,
  onOpenHome,
}: ProjectSidebarProps) {
  const readOnly = Boolean(snapshot && !snapshot.writable);

  const renderSession = (session: TerminalSessionView, peers: TerminalSessionView[]) => {
    const ProviderIcon = session.tool ? Wrench : providerDetails[session.kind].icon;
    const label = sessionLabel(session, peers);
    if (renamingSessionId === session.id) {
      return (
        <li key={session.id}>
          <SessionNameInput
            initialName={session.name ?? label}
            onSubmit={(name) => onRenameSession(session.id, name)}
            onCancel={onCancelRename}
          />
        </li>
      );
    }
    return (
      <li key={session.id}>
        <button
          className={`session-row status-${session.status} ${selectedSessionId === session.id ? "selected" : ""}`}
          type="button"
          onClick={() => onSelectSession(session)}
          onContextMenu={(event) => onSessionContextMenu(session, event)}
          aria-label={`${label} 세션 열기`}
        >
          <span className={`status-dot status-${session.status}`} aria-hidden="true" />
          <ProviderIcon size={14} />
          <span className="session-name" title={label}>
            {label}
          </span>
          <span className="session-status">{statusLabels[session.status]}</span>
        </button>
      </li>
    );
  };

  return (
    <aside className="project-sidebar">
      <button
        type="button"
        className={`brand-block ${isHome ? "selected" : ""}`}
        onClick={onOpenHome}
        aria-label="홈 대시보드 열기"
      >
        <span className="brand-mark" aria-hidden="true">
          <SquareTerminal size={17} strokeWidth={1.8} />
        </span>
        <div className="brand-copy">
          <h1>멀티 터미널 작업기</h1>
          <span className="brand-context">로컬 워크스페이스</span>
        </div>
      </button>

      <nav className="project-navigation" aria-label="폴더">
        <div className="section-heading">
          <span>폴더</span>
          <button
            className="icon-button"
            type="button"
            onClick={onReload}
            disabled={loading}
            aria-label="폴더 새로고침"
            title="폴더 새로고침"
          >
            <RefreshCw size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={onAddProject}
            disabled={readOnly}
            aria-label="폴더 열기"
            title="폴더 열기"
          >
            <FolderPlus size={16} />
          </button>
        </div>

        {loading ? (
          <div className="sidebar-state">
            <RefreshCw className="spin" size={15} />
            <span>작업 영역 불러오는 중</span>
          </div>
        ) : loadError ? (
          <div className="sidebar-failure" role="alert">
            <TriangleAlert size={16} />
            <span>{loadError}</span>
            <button type="button" onClick={onReload}>
              재시도
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="sidebar-empty">
            <FolderPlus size={18} aria-hidden="true" />
            <span>아직 폴더가 없습니다</span>
          </div>
        ) : (
          <ul className="project-tree" role="tree">
            {projects.map((project) => {
              const name = projectName(project);
              const expanded = expandedProjects.has(project.id);
              const rootMissing = snapshot?.missingRootProjectIds.includes(project.id) ?? false;
              const projectSessions = sessions
                .filter((session) => session.projectId === project.id)
                .sort(byCreation);
              return (
                <li className="project-node" key={project.id} role="treeitem" aria-expanded={expanded}>
                  <div
                    className={`project-row ${selectedProjectId === project.id ? "selected" : ""} ${rootMissing ? "missing" : ""}`}
                    onContextMenu={(event) => onProjectContextMenu(project, event)}
                  >
                    <button
                      className="tree-toggle"
                      type="button"
                      onClick={() => onToggleProject(project.id)}
                      aria-label={`${name} ${expanded ? "접기" : "펼치기"}`}
                      title={`${name} ${expanded ? "접기" : "펼치기"}`}
                    >
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <button
                      className="project-select"
                      type="button"
                      onClick={() => onSelectProject(project.id)}
                      aria-label={`${name} 폴더 선택`}
                    >
                      {rootMissing ? (
                        <FolderX size={15} aria-label="폴더 없음" />
                      ) : expanded ? (
                        <FolderOpen size={15} />
                      ) : (
                        <Folder size={15} />
                      )}
                      <span className="project-copy">
                        <span className="project-name">{name}</span>
                        <span className="project-path" title={project.rootPath}>
                          {project.rootPath}
                        </span>
                      </span>
                      {rootMissing ? <span className="project-status missing-status">없음</span> : null}
                    </button>
                  </div>
                  {editingProjectId === project.id ? (
                    <ProjectMetadataEditor project={project} onSaved={onProjectSaved} onClose={onCloseEditor} />
                  ) : null}
                  {expanded ? (
                    <ul className="session-tree" role="group">
                      {projectSessions.map((session) => renderSession(session, projectSessions))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {toolSessions.length > 0 ? (
          <div className="tools-group">
            <div className="section-heading">
              <span>도구</span>
            </div>
            <ul className="session-tree" role="group" aria-label="유지보수 세션">
              {[...toolSessions].sort(byCreation).map((session) => renderSession(session, toolSessions))}
            </ul>
          </div>
        ) : null}
      </nav>

      {snapshot?.warning ? (
        <div className="registry-warning" role="status">
          <TriangleAlert size={13} />
          <span>{snapshot.warning}</span>
          {!snapshot.writable && snapshot.source === "backup" ? (
            <button type="button" onClick={onRestoreBackup} aria-label="백업에서 레지스트리 복구">
              복구
            </button>
          ) : null}
        </div>
      ) : null}
      <UpdateBadge />
      <footer className="sidebar-footer">
        <span className="connection-dot" aria-hidden="true" />
        <span>폴더 {projects.length}개</span>
        <span className="footer-separator">/</span>
        <span>세션 {sessions.length + toolSessions.length}개</span>
      </footer>
    </aside>
  );
}
