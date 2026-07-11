import type { ProviderAvailability, TerminalSessionView } from "@shared/api-types";
import type { ProjectRegistrySnapshot, SharedProject } from "@shared/project-types";
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
  MonitorDot,
  Plus,
  RefreshCw,
  RotateCcw,
  SquareTerminal,
  Terminal as TerminalIcon,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TerminalPane } from "./TerminalPane";

const DEFAULT_TERMINAL_SIZE = { cols: 80, rows: 24 };
const EMPTY_AVAILABILITY: ProviderAvailability = { powershell: false, claude: false, codex: false };

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

function statusFromEvent(session: TerminalSessionView, event: TerminalWorkerEvent): TerminalSessionView {
  if (event.type === "status") return { ...session, status: event.status };
  if (event.type === "exit") {
    return { ...session, status: "exited", pid: null, exitCode: event.exitCode };
  }
  return session;
}

export function App() {
  const [snapshot, setSnapshot] = useState<ProjectRegistrySnapshot | null>(null);
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

  const projects = useMemo(() => {
    if (!snapshot) return [];
    return Object.values(snapshot.registry.projects)
      .filter((project) => !project.hidden)
      .sort((left, right) => {
        const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder || projectName(left).localeCompare(projectName(right));
      });
  }, [snapshot]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [listed, refreshed, terminalSessions, providers] = await Promise.all([
        window.multiCliWork.projects.list(),
        window.multiCliWork.projects.refresh(),
        window.multiCliWork.terminals.list(),
        window.multiCliWork.providers.availability(),
      ]);
      const registrySnapshot = refreshed ?? listed;
      const visibleProjects = Object.values(registrySnapshot.registry.projects)
        .filter((project) => !project.hidden)
        .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER));
      const initialProject = visibleProjects[0] ?? null;
      const initialSession = initialProject
        ? terminalSessions
            .filter((session) => session.projectId === initialProject.id)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
        : null;

      setSnapshot(registrySnapshot);
      setSessions(terminalSessions);
      setAvailability(providers);
      setExpandedProjects(new Set(visibleProjects.map((project) => project.id)));
      setSelectedProjectId((current) =>
        current && visibleProjects.some((project) => project.id === current) ? current : initialProject?.id ?? null,
      );
      setSelectedSessionId((current) =>
        current && terminalSessions.some((session) => session.id === current) ? current : initialSession?.id ?? null,
      );
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

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
    if (!selectedProject || !availability[kind]) return;
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
    if (!selectedSession) return;
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
    <div className="app-shell">
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
            <button className="icon-button" type="button" onClick={() => void addProject()} aria-label="Add project" title="Add project">
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
                const projectSessions = sessions
                  .filter((session) => session.projectId === project.id)
                  .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
                return (
                  <li className="project-node" key={project.id} role="treeitem" aria-expanded={expanded}>
                    <div className={`project-row ${selectedProjectId === project.id ? "selected" : ""}`}>
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
                        {expanded ? <FolderOpen size={15} /> : <Folder size={15} />}
                        <span className="project-copy">
                          <span className="project-name">{name}</span>
                          <span className="project-path" title={project.rootPath}>{project.rootPath}</span>
                        </span>
                        {project.status ? <span className="project-status">{project.status}</span> : null}
                      </button>
                    </div>
                    {expanded ? (
                      <ul className="session-tree" role="group">
                        {projectSessions.map((session) => {
                          const details = providerDetails[session.kind];
                          const ProviderIcon = details.icon;
                          return (
                            <li key={session.id}>
                              <button
                                className={`session-row ${selectedSessionId === session.id ? "selected" : ""}`}
                                type="button"
                                onClick={() => selectSession(session)}
                                aria-label={`Open ${details.label} session`}
                              >
                                <span className={`status-dot status-${session.status}`} aria-hidden="true" />
                                <ProviderIcon size={14} />
                                <span className="session-name">{details.label}</span>
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

        {snapshot?.warning ? <div className="registry-warning" role="status"><TriangleAlert size={13} /><span>{snapshot.warning}</span></div> : null}
        <footer className="sidebar-footer">
          <span className="connection-dot" aria-hidden="true" />
          <span>{projects.length} projects</span>
          <span className="footer-separator">/</span>
          <span>{sessions.length} sessions</span>
        </footer>
      </aside>

      <main className="terminal-workspace" aria-label="Terminal workspace">
        <header className="workspace-header">
          <div className="workspace-identity">
            <MonitorDot size={16} aria-hidden="true" />
            <div className="workspace-copy">
              <span className="workspace-title">
                {selectedProject ? projectName(selectedProject) : "No project selected"}
                {selectedSession ? <><span className="breadcrumb-separator">/</span>{providerDetails[selectedSession.kind].label}</> : null}
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
              <button className="icon-button" type="button" onClick={() => void relinkProject()} aria-label="Relink project folder" title="Relink project folder">
                <FolderOpen size={15} />
              </button>
            ) : null}
            {selectedSession && finished ? (
              <button className="command-button" type="button" onClick={() => void resumeSession()} disabled={pendingAction} aria-label="Resume session" title="Resume session">
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
                disabled={!selectedProject || pendingAction}
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
              onAttached={(attached) => setSessions((current) => replaceSession(current, attached))}
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
