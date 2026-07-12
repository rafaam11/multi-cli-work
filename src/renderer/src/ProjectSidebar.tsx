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
import type { MouseEvent as ReactMouseEvent } from "react";
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
  loading: boolean;
  loadError: string | null;
  onReload(): void;
  onAddProject(): void;
  onSelectProject(projectId: string): void;
  onSelectSession(session: TerminalSessionView): void;
  onToggleProject(projectId: string): void;
  onProjectContextMenu(project: SharedProject, event: ReactMouseEvent): void;
  onProjectSaved(project: SharedProject): void;
  onCloseEditor(): void;
  onRestoreBackup(): void;
}

/**
 * Sessions keep the order they were created in. Sorting by updatedAt would shuffle the tree every
 * time a session emitted a status change, so merely opening one would jump it to the top.
 */
function byCreation(left: TerminalSessionView, right: TerminalSessionView): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
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
  loading,
  loadError,
  onReload,
  onAddProject,
  onSelectProject,
  onSelectSession,
  onToggleProject,
  onProjectContextMenu,
  onProjectSaved,
  onCloseEditor,
  onRestoreBackup,
}: ProjectSidebarProps) {
  const readOnly = Boolean(snapshot && !snapshot.writable);

  const renderSession = (session: TerminalSessionView, peers: TerminalSessionView[]) => {
    const ProviderIcon = session.tool ? Wrench : providerDetails[session.kind].icon;
    const label = sessionLabel(session, peers);
    return (
      <li key={session.id}>
        <button
          className={`session-row ${selectedSessionId === session.id ? "selected" : ""}`}
          type="button"
          onClick={() => onSelectSession(session)}
          aria-label={`Open ${label} session`}
        >
          <span className={`status-dot status-${session.status}`} aria-hidden="true" />
          <ProviderIcon size={14} />
          <span className="session-name">{label}</span>
          <span className="session-status">{statusLabels[session.status]}</span>
        </button>
      </li>
    );
  };

  return (
    <aside className="project-sidebar">
      <header className="brand-block">
        <span className="brand-mark" aria-hidden="true">
          <SquareTerminal size={17} strokeWidth={1.8} />
        </span>
        <div className="brand-copy">
          <h1>Multi CLI Work</h1>
          <span className="brand-context">Local workspace</span>
        </div>
      </header>

      <nav className="project-navigation" aria-label="Folders">
        <div className="section-heading">
          <span>Folders</span>
          <button
            className="icon-button"
            type="button"
            onClick={onReload}
            disabled={loading}
            aria-label="Refresh folders"
            title="Refresh folders"
          >
            <RefreshCw size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={onAddProject}
            disabled={readOnly}
            aria-label="Open folder"
            title="Open folder"
          >
            <FolderPlus size={16} />
          </button>
        </div>

        {loading ? (
          <div className="sidebar-state">
            <RefreshCw className="spin" size={15} />
            <span>Loading workspace</span>
          </div>
        ) : loadError ? (
          <div className="sidebar-failure" role="alert">
            <TriangleAlert size={16} />
            <span>{loadError}</span>
            <button type="button" onClick={onReload}>
              Retry
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="sidebar-empty">
            <FolderPlus size={18} aria-hidden="true" />
            <span>No folders yet</span>
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
                      aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`}
                      title={`${expanded ? "Collapse" : "Expand"} ${name}`}
                    >
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <button
                      className="project-select"
                      type="button"
                      onClick={() => onSelectProject(project.id)}
                      aria-label={`Select folder ${name}`}
                    >
                      {rootMissing ? (
                        <FolderX size={15} aria-label="Folder missing" />
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
                      {rootMissing ? <span className="project-status missing-status">Missing</span> : null}
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
              <span>Tools</span>
            </div>
            <ul className="session-tree" role="group" aria-label="Maintenance sessions">
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
            <button type="button" onClick={onRestoreBackup} aria-label="Restore registry from backup">
              Restore
            </button>
          ) : null}
        </div>
      ) : null}
      <UpdateBadge />
      <footer className="sidebar-footer">
        <span className="connection-dot" aria-hidden="true" />
        <span>{projects.length} folders</span>
        <span className="footer-separator">/</span>
        <span>{sessions.length + toolSessions.length} sessions</span>
      </footer>
    </aside>
  );
}
