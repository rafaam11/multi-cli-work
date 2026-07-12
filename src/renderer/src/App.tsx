import type { ProjectWorkspaceSnapshot, ProviderAvailability, TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalKind, TerminalStatus, TerminalWorkerEvent } from "@shared/terminal-types";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleStop,
  Code2,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderX,
  MonitorDot,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  SquareTerminal,
  Terminal as TerminalIcon,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { ProjectMetadataEditor } from "./ProjectMetadataEditor";
import { TerminalPane } from "./TerminalPane";
import { UpdateBadge } from "./UpdateBadge";

const DEFAULT_TERMINAL_SIZE = { cols: 80, rows: 24 };
const EMPTY_AVAILABILITY: ProviderAvailability = { powershell: false, claude: false, codex: false };
const DEFAULT_SIDEBAR_WIDTH = 264;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 420;
const MIN_WORKSPACE_WIDTH = 480;
const SIDEBAR_RESIZER_WIDTH = 4;

const providerDetails: Record<
  TerminalKind,
  { label: string; menuLabel: string; icon: typeof TerminalIcon }
> = {
  powershell: { label: "PowerShell", menuLabel: "New PowerShell session", icon: TerminalIcon },
  claude: { label: "Claude Code", menuLabel: "New Claude Code session", icon: Bot },
  codex: { label: "Codex", menuLabel: "New Codex session", icon: Code2 },
};

const statusLabels: Record<TerminalStatus, string> = {
  starting: "Starting",
  working: "Working",
  "awaiting-input": "Input needed",
  "awaiting-approval": "Approval needed",
  idle: "Idle",
  exited: "Exited",
  error: "Error",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectName(project: SharedProject): string {
  const fallback = project.rootPath.split(/[\\/]/).filter(Boolean).at(-1);
  return project.displayName?.trim() || fallback || project.rootPath;
}

function replaceSession(sessions: TerminalSessionView[], next: TerminalSessionView): TerminalSessionView[] {
  const index = sessions.findIndex((session) => session.id === next.id);
  if (index === -1) return [...sessions, next];
  return sessions.map((session) => (session.id === next.id ? next : session));
}

function mergeAttachedSession(sessions: TerminalSessionView[], attached: TerminalSessionView): TerminalSessionView[] {
  return sessions.map((current) => {
    if (current.id !== attached.id) return current;
    const currentFinished = current.status === "exited" || current.status === "error";
    const attachedFinished = attached.status === "exited" || attached.status === "error";
    return currentFinished && !attachedFinished ? current : attached;
  });
}

function statusFromEvent(session: TerminalSessionView, event: TerminalWorkerEvent): TerminalSessionView {
  if (event.type === "status") return { ...session, status: event.status };
  if (event.type === "exit") {
    return { ...session, status: "exited", pid: null, exitCode: event.exitCode };
  }
  return session;
}

function providerSessionLabel(session: TerminalSessionView, projectSessions: TerminalSessionView[]): string {
  const base = providerDetails[session.kind].label;
  const peers = projectSessions
    .filter((candidate) => candidate.kind === session.kind)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  if (peers.length < 2) return base;
  return `${base} ${peers.findIndex((candidate) => candidate.id === session.id) + 1}`;
}

export function App() {
  const [snapshot, setSnapshot] = useState<ProjectWorkspaceSnapshot | null>(null);
  const [sessions, setSessions] = useState<TerminalSessionView[]>([]);
  const [availability, setAvailability] = useState(EMPTY_AVAILABILITY);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [showHiddenProjects, setShowHiddenProjects] = useState(false);

  const projects = useMemo(() => {
    if (!snapshot) return [];
    return Object.values(snapshot.registry.projects)
      .filter((project) => showHiddenProjects || !project.hidden)
      .sort((left, right) => {
        const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || projectName(left).localeCompare(projectName(right));
      });
  }, [snapshot, showHiddenProjects]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
  const selectedSessionLabel = selectedSession
    ? providerSessionLabel(
        selectedSession,
        sessions.filter((session) => session.projectId === selectedSession.projectId),
      )
    : null;
  const selectedProjectMissing = Boolean(
    selectedProject && snapshot?.missingRootProjectIds.includes(selectedProject.id),
  );

  const maximumSidebarWidth = useCallback(
    () => Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - MIN_WORKSPACE_WIDTH - SIDEBAR_RESIZER_WIDTH)),
    [],
  );

  const clampSidebarWidth = useCallback(
    (width: number) => Math.min(maximumSidebarWidth(), Math.max(MIN_SIDEBAR_WIDTH, width)),
    [maximumSidebarWidth],
  );

  const loadWorkspace = useCallback(async (preservedSelection?: { projectId: string | null; sessionId: string | null }) => {
    setLoading(true);
    setLoadError(null);
    try {
      const refreshResultPromise = window.multiCliWork.projects.refresh().then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const [listed, refreshResult, terminalSessions, providers, appState] = await Promise.all([
        window.multiCliWork.projects.list(),
        refreshResultPromise,
        window.multiCliWork.terminals.list(),
        window.multiCliWork.providers.availability(),
        window.multiCliWork.terminals.state(),
      ]);
      const registrySnapshot = refreshResult.ok
        ? refreshResult.value
        : {
            ...listed,
            warning: [listed.warning, `Project discovery refresh failed: ${errorMessage(refreshResult.error)}`]
              .filter(Boolean)
              .join(" "),
          };
      const visibleProjects = Object.values(registrySnapshot.registry.projects)
        .filter((project) => !project.hidden)
        .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER));
      const preferredProjectId = preservedSelection ? preservedSelection.projectId : appState.state.selectedProjectId;
      const restoredProject = visibleProjects.find((project) => project.id === preferredProjectId) ?? null;
      const initialProject = restoredProject ?? visibleProjects[0] ?? null;
      const preferredSessionId = preservedSelection ? preservedSelection.sessionId : appState.state.selectedSessionId;
      const restoredSession = terminalSessions.find((session) => session.id === preferredSessionId) ?? null;
      const initialSession = restoredProject
        ? restoredSession?.projectId === restoredProject.id
          ? restoredSession
          : null
        : initialProject
          ? terminalSessions
              .filter((session) => session.projectId === initialProject.id)
              .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
          : null;

      setSnapshot(registrySnapshot);
      setSessions(terminalSessions);
      setAvailability(providers);
      setExpandedProjects(new Set(visibleProjects.map((project) => project.id)));
      setSelectedProjectId(initialProject?.id ?? null);
      setSelectedSessionId(initialSession?.id ?? null);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    const handleWindowResize = () => setSidebarWidth((current) => clampSidebarWidth(current));
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [clampSidebarWidth]);

  const beginSidebarResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      document.body.classList.add("sidebar-resizing");
      const handleMouseMove = (moveEvent: MouseEvent) => setSidebarWidth(clampSidebarWidth(moveEvent.clientX));
      const handleMouseUp = () => {
        document.body.classList.remove("sidebar-resizing");
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [clampSidebarWidth],
  );

  useEffect(
    () =>
      window.multiCliWork.terminals.onEvent((event) => {
        if (event.type === "data") return;
        setSessions((current) =>
          current.map((session) => (session.id === event.sessionId ? statusFromEvent(session, event) : session)),
        );
      }),
    [],
  );

  const persistSelection = useCallback((projectId: string | null, sessionId: string | null) => {
    void window.multiCliWork.terminals.select(projectId, sessionId).catch((error) => {
      setActionError(errorMessage(error));
    });
  }, []);

  const selectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setSelectedSessionId(null);
    setExpandedProjects((current) => new Set(current).add(projectId));
    setSessionMenuOpen(false);
    setActionError(null);
    persistSelection(projectId, null);
  };

  const selectSession = (session: TerminalSessionView) => {
    setSelectedProjectId(session.projectId);
    setSelectedSessionId(session.id);
    setSessionMenuOpen(false);
    setActionError(null);
    persistSelection(session.projectId, session.id);
  };

  const toggleProject = (projectId: string) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const addProject = async () => {
    setActionError(null);
    try {
      const added = await window.multiCliWork.projects.addFolder();
      if (!added) return;
      setSnapshot((current) => {
        if (!current) return current;
        return {
          ...current,
          registry: {
            ...current.registry,
            projects: { ...current.registry.projects, [added.id]: added },
          },
        };
      });
      setExpandedProjects((current) => new Set(current).add(added.id));
      setSelectedProjectId(added.id);
      setSelectedSessionId(null);
      persistSelection(added.id, null);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const startSession = async (kind: TerminalKind) => {
    if (!selectedProject || selectedProjectMissing || !availability[kind]) return;
    setSessionMenuOpen(false);
    setPendingAction(true);
    setActionError(null);
    try {
      const created = await window.multiCliWork.terminals.create({
        projectId: selectedProject.id,
        kind,
        ...DEFAULT_TERMINAL_SIZE,
      });
      setSessions((current) => replaceSession(current, created));
      setSelectedSessionId(created.id);
      persistSelection(selectedProject.id, created.id);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingAction(false);
    }
  };

  const resumeSession = async () => {
    if (!selectedSession || selectedProjectMissing) return;
    setPendingAction(true);
    setActionError(null);
    try {
      const resumed = await window.multiCliWork.terminals.resume({
        sessionId: selectedSession.id,
        ...DEFAULT_TERMINAL_SIZE,
      });
      setSessions((current) => replaceSession(current, resumed));
      persistSelection(resumed.projectId, resumed.id);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingAction(false);
    }
  };

  const stopSession = async () => {
    if (!selectedSession) return;
    setPendingAction(true);
    setActionError(null);
    try {
      await window.multiCliWork.terminals.stop(selectedSession.id);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingAction(false);
    }
  };

  const removeSession = async () => {
    if (!selectedSession) return;
    const projectId = selectedSession.projectId;
    setPendingAction(true);
    setActionError(null);
    try {
      await window.multiCliWork.terminals.remove(selectedSession.id);
      setSessions((current) => current.filter((session) => session.id !== selectedSession.id));
      setSelectedSessionId(null);
      persistSelection(projectId, null);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingAction(false);
    }
  };

  const restoreFromBackup = async () => {
    setActionError(null);
    try {
      const restored = await window.multiCliWork.projects.restoreBackup();
      setSnapshot(restored);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const handleProjectSaved = (updated: SharedProject) => {
    setSnapshot((current) => {
      if (!current) return current;
      return {
        ...current,
        registry: {
          ...current.registry,
          projects: { ...current.registry.projects, [updated.id]: updated },
        },
      };
    });
    if (updated.hidden && !showHiddenProjects && selectedProjectId === updated.id) {
      setSelectedProjectId(null);
      setSelectedSessionId(null);
      persistSelection(null, null);
    }
  };

  const relinkProject = async () => {
    if (!selectedProject) return;
    setActionError(null);
    try {
      const relinked = await window.multiCliWork.projects.relink(selectedProject.id);
      if (!relinked) return;
      setSnapshot((current) => {
        if (!current) return current;
        return {
          ...current,
          missingRootProjectIds: current.missingRootProjectIds.filter((id) => id !== relinked.id),
          registry: {
            ...current.registry,
            projects: { ...current.registry.projects, [relinked.id]: relinked },
          },
        };
      });
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const finished = selectedSession?.status === "exited" || selectedSession?.status === "error";

  return (
    <div
      className="app-shell"
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
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

        <nav className="project-navigation" aria-label="Projects">
          <div className="section-heading">
            <span>Projects</span>
            <button
              className="icon-button"
              type="button"
              onClick={() => void loadWorkspace({ projectId: selectedProjectId, sessionId: selectedSessionId })}
              disabled={loading}
              aria-label="Refresh projects"
              title="Refresh projects"
            >
              <RefreshCw size={16} />
            </button>
            <button className="icon-button" type="button" onClick={() => void addProject()} disabled={Boolean(snapshot && !snapshot.writable)} aria-label="Add project" title="Add project">
              <FolderPlus size={16} />
            </button>
          </div>

          {loading ? (
            <div className="sidebar-state"><RefreshCw className="spin" size={15} /><span>Loading workspace</span></div>
          ) : loadError ? (
            <div className="sidebar-failure" role="alert">
              <TriangleAlert size={16} />
              <span>{loadError}</span>
              <button type="button" onClick={() => void loadWorkspace()}>Retry</button>
            </div>
          ) : projects.length === 0 ? (
            <div className="sidebar-empty">
              <FolderPlus size={18} aria-hidden="true" />
              <span>No projects yet</span>
            </div>
          ) : (
            <ul className="project-tree" role="tree">
              {projects.map((project) => {
                const name = projectName(project);
                const expanded = expandedProjects.has(project.id);
                const rootMissing = snapshot?.missingRootProjectIds.includes(project.id) ?? false;
                const projectSessions = sessions
                  .filter((session) => session.projectId === project.id)
                  .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
                return (
                  <li className="project-node" key={project.id} role="treeitem" aria-expanded={expanded}>
                    <div className={`project-row ${selectedProjectId === project.id ? "selected" : ""} ${rootMissing ? "missing" : ""} ${project.hidden ? "hidden-project" : ""}`}>
                      <button
                        className="tree-toggle"
                        type="button"
                        onClick={() => toggleProject(project.id)}
                        aria-label={`${expanded ? "Collapse" : "Expand"} ${name}`}
                        title={`${expanded ? "Collapse" : "Expand"} ${name}`}
                      >
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <button className="project-select" type="button" onClick={() => selectProject(project.id)} aria-label={`Select project ${name}`}>
                        {rootMissing ? <FolderX size={15} aria-label="Project folder missing" /> : expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
                        <span className="project-copy">
                          <span className="project-name">{name}</span>
                          <span className="project-path" title={project.rootPath}>{project.rootPath}</span>
                        </span>
                        {rootMissing ? <span className="project-status missing-status">Missing</span> : project.hidden ? <span className="project-status hidden-status">Hidden</span> : project.status ? <span className="project-status">{project.status}</span> : null}
                      </button>
                      <button
                        className="icon-button project-edit"
                        type="button"
                        onClick={() => setEditingProjectId((current) => (current === project.id ? null : project.id))}
                        disabled={Boolean(snapshot && !snapshot.writable)}
                        aria-label={`Edit project ${name}`}
                        title="Edit project"
                      >
                        <Pencil size={13} />
                      </button>
                    </div>
                    {editingProjectId === project.id ? (
                      <ProjectMetadataEditor
                        project={project}
                        onSaved={handleProjectSaved}
                        onClose={() => setEditingProjectId(null)}
                      />
                    ) : null}
                    {expanded ? (
                      <ul className="session-tree" role="group">
                        {projectSessions.map((session) => {
                          const details = providerDetails[session.kind];
                          const ProviderIcon = details.icon;
                          const label = providerSessionLabel(session, projectSessions);
                          return (
                            <li key={session.id}>
                              <button
                                className={`session-row ${selectedSessionId === session.id ? "selected" : ""}`}
                                type="button"
                                onClick={() => selectSession(session)}
                                aria-label={`Open ${label} session`}
                              >
                                <span className={`status-dot status-${session.status}`} aria-hidden="true" />
                                <ProviderIcon size={14} />
                                <span className="session-name">{label}</span>
                                <span className="session-status">{statusLabels[session.status]}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {snapshot?.warning ? (
          <div className="registry-warning" role="status">
            <TriangleAlert size={13} />
            <span>{snapshot.warning}</span>
            {!snapshot.writable && snapshot.source === "backup" ? (
              <button type="button" onClick={() => void restoreFromBackup()} aria-label="Restore registry from backup">
                Restore
              </button>
            ) : null}
          </div>
        ) : null}
        <label className="hidden-toggle">
          <input
            type="checkbox"
            checked={showHiddenProjects}
            onChange={(event) => setShowHiddenProjects(event.target.checked)}
          />
          <span>Show hidden projects</span>
        </label>
        <UpdateBadge />
        <footer className="sidebar-footer">
          <span className="connection-dot" aria-hidden="true" />
          <span>{projects.length} projects</span>
          <span className="footer-separator">/</span>
          <span>{sessions.length} sessions</span>
        </footer>
      </aside>

      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="Resize project sidebar"
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={maximumSidebarWidth()}
        aria-valuenow={sidebarWidth}
        onMouseDown={beginSidebarResize}
      />

      <main className="terminal-workspace" aria-label="Terminal workspace">
        <header className="workspace-header">
          <div className="workspace-identity">
            <MonitorDot size={16} aria-hidden="true" />
            <div className="workspace-copy">
              <span className="workspace-title">
                {selectedProject ? projectName(selectedProject) : "No project selected"}
                {selectedSession ? <><span className="breadcrumb-separator">/</span>{selectedSessionLabel}</> : null}
              </span>
              <span className="workspace-path" title={selectedProject?.rootPath}>{selectedProject?.rootPath ?? "Local terminal workspace"}</span>
            </div>
          </div>

          <div className="workspace-actions">
            {selectedSession ? (
              <span className={`active-status status-${selectedSession.status}`}>
                <span className={`status-dot status-${selectedSession.status}`} aria-hidden="true" />
                {statusLabels[selectedSession.status]}
              </span>
            ) : null}
            {selectedProject ? (
              <button className="icon-button" type="button" onClick={() => void relinkProject()} disabled={Boolean(snapshot && !snapshot.writable)} aria-label="Relink project folder" title="Relink project folder">
                <FolderOpen size={15} />
              </button>
            ) : null}
            {selectedSession && finished ? (
              <button className="command-button" type="button" onClick={() => void resumeSession()} disabled={pendingAction || selectedProjectMissing} aria-label="Resume session" title={selectedProjectMissing ? "Relink the project folder before resuming" : "Resume session"}>
                <RotateCcw size={14} /><span>Resume</span>
              </button>
            ) : null}
            {selectedSession && !finished ? (
              <button className="icon-button" type="button" onClick={() => void stopSession()} disabled={pendingAction} aria-label="Stop session" title="Stop session">
                <CircleStop size={15} />
              </button>
            ) : null}
            {selectedSession ? (
              <button className="icon-button danger-button" type="button" onClick={() => void removeSession()} disabled={pendingAction} aria-label="Remove session" title="Remove session">
                <Trash2 size={15} />
              </button>
            ) : null}
            <div className="session-menu-anchor">
              <button
                className="new-session-button"
                type="button"
                disabled={!selectedProject || selectedProjectMissing || pendingAction}
                title={selectedProjectMissing ? "Relink the project folder before starting a session" : "New session"}
                aria-expanded={sessionMenuOpen}
                aria-haspopup="menu"
                onClick={() => setSessionMenuOpen((open) => !open)}
              >
                <Plus size={15} />
                New session
                <ChevronDown size={13} />
              </button>
              {sessionMenuOpen ? (
                <div className="provider-menu" role="menu">
                  {(Object.keys(providerDetails) as TerminalKind[]).map((kind) => {
                    const details = providerDetails[kind];
                    const ProviderIcon = details.icon;
                    return (
                      <button
                        key={kind}
                        type="button"
                        role="menuitem"
                        disabled={!availability[kind]}
                        onClick={() => void startSession(kind)}
                        aria-label={details.menuLabel}
                        title={availability[kind] ? details.menuLabel : `${details.label} is not installed`}
                      >
                        <ProviderIcon size={15} />
                        <span>{details.label}</span>
                        {!availability[kind] ? <span className="provider-unavailable">Unavailable</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="workspace-body">
          <div className="workspace-message-area">
            {selectedProjectMissing ? (
              <div className="missing-root-notice" role="status">
                <FolderX size={14} />
                <span>Project folder is missing</span>
                <button type="button" onClick={() => void relinkProject()} disabled={Boolean(snapshot && !snapshot.writable)} aria-label="Relink missing project folder">Relink</button>
              </div>
            ) : null}
            {actionError ? (
              <div className="action-error" role="alert">
                <TriangleAlert size={14} />
                <span>{actionError}</span>
                <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss error">Dismiss</button>
              </div>
            ) : null}
          </div>

          {loading ? (
            <section className="terminal-empty"><RefreshCw className="spin" size={20} /><h2>Loading workspace</h2></section>
          ) : loadError ? (
            <section className="terminal-empty"><TriangleAlert size={22} /><h2>Workspace could not be loaded</h2></section>
          ) : selectedSession ? (
            <TerminalPane
              key={selectedSession.id}
              session={selectedSession}
              onAttached={(attached) => setSessions((current) => mergeAttachedSession(current, attached))}
              onError={(message) => setActionError(message)}
            />
          ) : (
            <section className="terminal-empty" aria-label="Terminal workspace empty">
              <div className="empty-glyph" aria-hidden="true"><span>&gt;_</span></div>
              <h2>{selectedProject ? `Start a session in ${projectName(selectedProject)}` : "Choose a project to start a session"}</h2>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
