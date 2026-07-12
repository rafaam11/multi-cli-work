import type { ProjectWorkspaceSnapshot, ProviderAvailability, TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalEvent, TerminalKind, ToolCommand } from "@shared/terminal-types";
import { FolderX, RefreshCw, TriangleAlert } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { HomeDashboard, type ActivityEntry } from "./HomeDashboard";
import { ProjectContextMenu } from "./ProjectContextMenu";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { ProjectSidebar } from "./ProjectSidebar";
import { SessionContextMenu } from "./SessionContextMenu";
import { TerminalPane } from "./TerminalPane";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { projectName, sessionLabel } from "./session-labels";

type ActiveView = "home" | "detail" | "terminal";
const ACTIVITY_LOG_LIMIT = 20;

const DEFAULT_TERMINAL_SIZE = { cols: 80, rows: 24 };
const EMPTY_AVAILABILITY: ProviderAvailability = { powershell: false, claude: false, codex: false, vscode: false };
const DEFAULT_SIDEBAR_WIDTH = 264;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 420;
const MIN_WORKSPACE_WIDTH = 480;
const SIDEBAR_RESIZER_WIDTH = 4;

interface ContextMenuState {
  project: SharedProject;
  x: number;
  y: number;
}

interface RemovalState {
  project: SharedProject;
  sessionCount: number;
}

interface SessionMenuState {
  session: TerminalSessionView;
  label: string;
  x: number;
  y: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function applyEvent(session: TerminalSessionView, event: TerminalEvent): TerminalSessionView {
  if (event.type === "status") return { ...session, status: event.status };
  if (event.type === "title") return { ...session, title: event.title };
  if (event.type === "exit") {
    return { ...session, status: "exited", pid: null, exitCode: event.exitCode };
  }
  return session;
}

export function App() {
  const [snapshot, setSnapshot] = useState<ProjectWorkspaceSnapshot | null>(null);
  const [sessions, setSessions] = useState<TerminalSessionView[]>([]);
  const [availability, setAvailability] = useState(EMPTY_AVAILABILITY);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<ActiveView>("home");
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const sessionsRef = useRef<TerminalSessionView[]>([]);
  const activityIdRef = useRef(0);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [removal, setRemoval] = useState<RemovalState | null>(null);

  const projects = useMemo(() => {
    if (!snapshot) return [];
    return Object.values(snapshot.registry.projects).sort(
      (left, right) =>
        (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
        projectName(left).localeCompare(projectName(right)),
    );
  }, [snapshot]);

  const folderSessions = useMemo(() => sessions.filter((session) => session.projectId !== null), [sessions]);
  const toolSessions = useMemo(() => sessions.filter((session) => session.projectId === null), [sessions]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
  const selectedSessionLabel = selectedSession
    ? sessionLabel(
        selectedSession,
        sessions.filter((session) => session.projectId === selectedSession.projectId),
      )
    : null;
  const selectedProjectMissing = Boolean(
    selectedProject && snapshot?.missingRootProjectIds.includes(selectedProject.id),
  );
  const isProjectMissing = useCallback(
    (projectId: string) => Boolean(snapshot?.missingRootProjectIds.includes(projectId)),
    [snapshot],
  );

  const maximumSidebarWidth = useCallback(
    () =>
      Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - MIN_WORKSPACE_WIDTH - SIDEBAR_RESIZER_WIDTH),
      ),
    [],
  );

  const clampSidebarWidth = useCallback(
    (width: number) => Math.min(maximumSidebarWidth(), Math.max(MIN_SIDEBAR_WIDTH, width)),
    [maximumSidebarWidth],
  );

  const loadWorkspace = useCallback(
    async (preservedSelection?: { projectId: string | null; sessionId: string | null; view?: ActiveView }) => {
      setLoading(true);
      setLoadError(null);
      const forceHome = preservedSelection?.view === "home";
      try {
        const [registrySnapshot, terminalSessions, providers, appState] = await Promise.all([
          window.multiCliWork.projects.list(),
          window.multiCliWork.terminals.list(),
          window.multiCliWork.providers.availability(),
          window.multiCliWork.terminals.state(),
        ]);
        const visibleProjects = Object.values(registrySnapshot.registry.projects).sort(
          (left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER),
        );
        const preferredProjectId = preservedSelection ? preservedSelection.projectId : appState.state.selectedProjectId;
        const preferredSessionId = preservedSelection ? preservedSelection.sessionId : appState.state.selectedSessionId;
        const restoredSession = terminalSessions.find((session) => session.id === preferredSessionId) ?? null;

        // A maintenance session belongs to no folder, so restoring it must not fall back to the
        // first folder in the list the way a plain "nothing selected" state does.
        if (restoredSession?.projectId === null) {
          setSnapshot(registrySnapshot);
          setSessions(terminalSessions);
          setAvailability(providers);
          setExpandedProjects(new Set(visibleProjects.map((project) => project.id)));
          setSelectedProjectId(null);
          setSelectedSessionId(restoredSession.id);
          setActiveView(forceHome ? "home" : "terminal");
          return;
        }

        const restoredProject = visibleProjects.find((project) => project.id === preferredProjectId) ?? null;
        const initialProject = restoredProject ?? visibleProjects[0] ?? null;
        const initialSession = restoredProject
          ? restoredSession?.projectId === restoredProject.id
            ? restoredSession
            : null
          : initialProject
            ? (terminalSessions
                .filter((session) => session.projectId === initialProject.id)
                .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null)
            : null;

        setSnapshot(registrySnapshot);
        setSessions(terminalSessions);
        setAvailability(providers);
        setExpandedProjects(new Set(visibleProjects.map((project) => project.id)));
        setSelectedProjectId(initialProject?.id ?? null);
        setSelectedSessionId(initialSession?.id ?? null);
        setActiveView(forceHome ? "home" : initialSession ? "terminal" : initialProject ? "detail" : "home");
      } catch (error) {
        setLoadError(errorMessage(error));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

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

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(
    () =>
      window.multiCliWork.terminals.onEvent((event) => {
        if (event.type === "data") return;
        if (event.type === "status") {
          const previous = sessionsRef.current.find((session) => session.id === event.sessionId);
          if (previous && previous.status !== event.status) {
            const peers = sessionsRef.current.filter((session) => session.projectId === previous.projectId);
            setActivityLog((log) =>
              [
                {
                  id: `activity-${activityIdRef.current++}`,
                  timestamp: new Date().toISOString(),
                  projectId: previous.projectId,
                  sessionId: previous.id,
                  sessionLabel: sessionLabel(previous, peers),
                  fromStatus: previous.status,
                  toStatus: event.status,
                },
                ...log,
              ].slice(0, ACTIVITY_LOG_LIMIT),
            );
          }
        }
        setSessions((current) =>
          current.map((session) => (session.id === event.sessionId ? applyEvent(session, event) : session)),
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
    setActiveView("detail");
    setExpandedProjects((current) => new Set(current).add(projectId));
    setActionError(null);
    persistSelection(projectId, null);
  };

  const selectSession = (session: TerminalSessionView) => {
    setSelectedProjectId(session.projectId);
    setSelectedSessionId(session.id);
    setActiveView("terminal");
    setActionError(null);
    persistSelection(session.projectId, session.id);
  };

  const openHome = () => setActiveView("home");

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
      setSnapshot((current) =>
        current
          ? {
              ...current,
              registry: {
                ...current.registry,
                projects: { ...current.registry.projects, [added.id]: added },
              },
            }
          : current,
      );
      setExpandedProjects((current) => new Set(current).add(added.id));
      setSelectedProjectId(added.id);
      setSelectedSessionId(null);
      setActiveView("detail");
      persistSelection(added.id, null);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const startSession = async (project: SharedProject, kind: TerminalKind) => {
    if (isProjectMissing(project.id) || !availability[kind]) return;
    setPendingAction(true);
    setActionError(null);
    try {
      const created = await window.multiCliWork.terminals.create({
        projectId: project.id,
        kind,
        ...DEFAULT_TERMINAL_SIZE,
      });
      setSessions((current) => replaceSession(current, created));
      setSelectedProjectId(project.id);
      setSelectedSessionId(created.id);
      setActiveView("terminal");
      persistSelection(project.id, created.id);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingAction(false);
    }
  };

  const startTool = async (tool: ToolCommand) => {
    setPendingAction(true);
    setActionError(null);
    try {
      const created = await window.multiCliWork.terminals.createTool({ tool, ...DEFAULT_TERMINAL_SIZE });
      setSessions((current) => replaceSession(current, created));
      setSelectedProjectId(null);
      setSelectedSessionId(created.id);
      setActiveView("terminal");
      persistSelection(null, created.id);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingAction(false);
    }
  };

  const resumeSession = async () => {
    if (!selectedSession) return;
    if (!selectedSession.tool && selectedProjectMissing) return;
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
      setActiveView(projectId ? "detail" : "home");
      persistSelection(projectId, null);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingAction(false);
    }
  };

  const renameSession = async (sessionId: string, name: string | null) => {
    setRenamingSessionId(null);
    setActionError(null);
    try {
      const renamed = await window.multiCliWork.terminals.rename(sessionId, name);
      setSessions((current) => replaceSession(current, renamed));
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const restoreFromBackup = async () => {
    setActionError(null);
    try {
      setSnapshot(await window.multiCliWork.projects.restoreBackup());
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const handleProjectSaved = (updated: SharedProject) => {
    setSnapshot((current) =>
      current
        ? {
            ...current,
            registry: {
              ...current.registry,
              projects: { ...current.registry.projects, [updated.id]: updated },
            },
          }
        : current,
    );
  };

  const relinkProject = async () => {
    if (!selectedProject) return;
    setActionError(null);
    try {
      const relinked = await window.multiCliWork.projects.relink(selectedProject.id);
      if (!relinked) return;
      setSnapshot((current) =>
        current
          ? {
              ...current,
              missingRootProjectIds: current.missingRootProjectIds.filter((id) => id !== relinked.id),
              registry: {
                ...current.registry,
                projects: { ...current.registry.projects, [relinked.id]: relinked },
              },
            }
          : current,
      );
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const runProjectAction = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const requestRemoval = (project: SharedProject) => {
    const sessionCount = folderSessions.filter((session) => session.projectId === project.id).length;
    if (sessionCount === 0) {
      void confirmRemoval(project);
      return;
    }
    setRemoval({ project, sessionCount });
  };

  const confirmRemoval = async (project: SharedProject) => {
    setRemoval(null);
    setPendingAction(true);
    setActionError(null);
    try {
      const next = await window.multiCliWork.projects.remove(project.id);
      setSnapshot(next);
      setSessions((current) => current.filter((session) => session.projectId !== project.id));
      if (selectedProjectId === project.id) {
        setSelectedProjectId(null);
        setSelectedSessionId(null);
        setActiveView("home");
        persistSelection(null, null);
      }
      if (editingProjectId === project.id) setEditingProjectId(null);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingAction(false);
    }
  };

  // The header mirrors whatever the sidebar has selected, except on the home dashboard: there it
  // would otherwise show a stale project/session left over from before "Home" was opened.
  const headerProject = activeView === "home" ? null : selectedProject;
  const headerSession = activeView === "home" ? null : selectedSession;
  const headerSessionLabel = activeView === "home" ? null : selectedSessionLabel;

  return (
    <div className="app-shell" style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <ProjectSidebar
        snapshot={snapshot}
        projects={projects}
        sessions={folderSessions}
        toolSessions={toolSessions}
        selectedProjectId={activeView === "home" ? null : selectedProjectId}
        selectedSessionId={activeView === "home" ? null : selectedSessionId}
        isHome={activeView === "home"}
        onOpenHome={openHome}
        expandedProjects={expandedProjects}
        editingProjectId={editingProjectId}
        renamingSessionId={renamingSessionId}
        loading={loading}
        loadError={loadError}
        onReload={() => void loadWorkspace({ projectId: selectedProjectId, sessionId: selectedSessionId, view: activeView })}
        onAddProject={() => void addProject()}
        onSelectProject={selectProject}
        onSelectSession={selectSession}
        onToggleProject={toggleProject}
        onProjectContextMenu={(project, event) => {
          event.preventDefault();
          setContextMenu({ project, x: event.clientX, y: event.clientY });
        }}
        onSessionContextMenu={(session, event) => {
          event.preventDefault();
          setSessionMenu({
            session,
            label: sessionLabel(
              session,
              sessions.filter((candidate) => candidate.projectId === session.projectId),
            ),
            x: event.clientX,
            y: event.clientY,
          });
        }}
        onRenameSession={(sessionId, name) => void renameSession(sessionId, name)}
        onCancelRename={() => setRenamingSessionId(null)}
        onProjectSaved={handleProjectSaved}
        onCloseEditor={() => setEditingProjectId(null)}
        onRestoreBackup={() => void restoreFromBackup()}
      />

      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="폴더 사이드바 크기 조절"
        aria-orientation="vertical"
        aria-valuemin={MIN_SIDEBAR_WIDTH}
        aria-valuemax={maximumSidebarWidth()}
        aria-valuenow={sidebarWidth}
        onMouseDown={beginSidebarResize}
      />

      <main className="terminal-workspace" aria-label="터미널 작업 영역">
        <WorkspaceHeader
          selectedProject={headerProject}
          selectedSession={headerSession}
          selectedSessionLabel={headerSessionLabel}
          projectMissing={selectedProjectMissing}
          availability={availability}
          pendingAction={pendingAction}
          readOnly={Boolean(snapshot && !snapshot.writable)}
          onStartSession={(kind) => selectedProject && void startSession(selectedProject, kind)}
          onStartTool={(tool) => void startTool(tool)}
          onResumeSession={() => void resumeSession()}
          onStopSession={() => void stopSession()}
          onRemoveSession={() => void removeSession()}
          onRelinkProject={() => void relinkProject()}
        />

        <div className="workspace-body">
          <div className="workspace-message-area">
            {activeView !== "home" && selectedProjectMissing ? (
              <div className="missing-root-notice" role="status">
                <FolderX size={14} />
                <span>폴더를 찾을 수 없습니다</span>
                <button
                  type="button"
                  onClick={() => void relinkProject()}
                  disabled={Boolean(snapshot && !snapshot.writable)}
                  aria-label="누락된 폴더 다시 연결"
                >
                  다시 연결
                </button>
              </div>
            ) : null}
            {actionError ? (
              <div className="action-error" role="alert">
                <TriangleAlert size={14} />
                <span>{actionError}</span>
                <button type="button" onClick={() => setActionError(null)} aria-label="오류 닫기">
                  닫기
                </button>
              </div>
            ) : null}
          </div>

          {loading ? (
            <section className="terminal-empty">
              <RefreshCw className="spin" size={20} />
              <h2>작업 영역 불러오는 중</h2>
            </section>
          ) : loadError ? (
            <section className="terminal-empty">
              <TriangleAlert size={22} />
              <h2>작업 영역을 불러오지 못했습니다</h2>
            </section>
          ) : activeView === "terminal" && selectedSession ? (
            <TerminalPane
              key={selectedSession.id}
              session={selectedSession}
              onAttached={(attached) => setSessions((current) => mergeAttachedSession(current, attached))}
              onError={(message) => setActionError(message)}
            />
          ) : activeView === "detail" && selectedProject ? (
            <ProjectDetailPage
              key={selectedProject.id}
              project={selectedProject}
              sessions={folderSessions.filter((session) => session.projectId === selectedProject.id)}
              availability={availability}
              pendingAction={pendingAction}
              onSelectSession={selectSession}
              onStartSession={(kind) => void startSession(selectedProject, kind)}
              onReveal={() => void runProjectAction(() => window.multiCliWork.projects.reveal(selectedProject.id))}
              onOpenInEditor={() => void runProjectAction(() => window.multiCliWork.projects.openInEditor(selectedProject.id))}
              onOpenOnGitHub={() => void runProjectAction(() => window.multiCliWork.projects.openOnGitHub(selectedProject.id))}
              onProjectSaved={handleProjectSaved}
            />
          ) : (
            <HomeDashboard
              projects={projects}
              sessions={sessions}
              availability={availability}
              activityLog={activityLog}
              pendingAction={pendingAction}
              onSelectSession={selectSession}
              onStartSession={(project, kind) => void startSession(project, kind)}
              onStartTool={(tool) => void startTool(tool)}
            />
          )}
        </div>
      </main>

      {contextMenu ? (
        <ProjectContextMenu
          projectName={projectName(contextMenu.project)}
          x={contextMenu.x}
          y={contextMenu.y}
          vscodeAvailable={availability.vscode}
          onReveal={() => void runProjectAction(() => window.multiCliWork.projects.reveal(contextMenu.project.id))}
          onOpenInEditor={() =>
            void runProjectAction(() => window.multiCliWork.projects.openInEditor(contextMenu.project.id))
          }
          onOpenOnGitHub={() =>
            void runProjectAction(() => window.multiCliWork.projects.openOnGitHub(contextMenu.project.id))
          }
          onRename={() => {
            setExpandedProjects((current) => new Set(current).add(contextMenu.project.id));
            setEditingProjectId(contextMenu.project.id);
          }}
          onRemove={() => requestRemoval(contextMenu.project)}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {sessionMenu ? (
        <SessionContextMenu
          sessionLabel={sessionMenu.label}
          x={sessionMenu.x}
          y={sessionMenu.y}
          canResetName={Boolean(sessionMenu.session.name)}
          onRename={() => setRenamingSessionId(sessionMenu.session.id)}
          onResetName={() => void renameSession(sessionMenu.session.id, null)}
          onClose={() => setSessionMenu(null)}
        />
      ) : null}

      {removal ? (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="목록에서 폴더 제거">
            <h2>{projectName(removal.project)}을(를) 목록에서 제거할까요?</h2>
            <p>
              이 폴더의 세션 {removal.sessionCount}개가 중지되고 스크롤백이 삭제됩니다. 폴더 자체는 디스크에 그대로
              남습니다.
            </p>
            <footer className="confirm-dialog-actions">
              <button type="button" onClick={() => setRemoval(null)}>
                취소
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => void confirmRemoval(removal.project)}
                disabled={pendingAction}
              >
                제거
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
