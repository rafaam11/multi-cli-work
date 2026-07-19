import type { AgentView } from "@shared/agent-types";
import type {
  GitDiffResult,
  ProjectWorkspaceSnapshot,
  ProviderAvailability,
  SessionAttention,
  TerminalSessionView,
} from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { SharedWorktree } from "@shared/worktree-types";
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
import { DiffView } from "./DiffView";
import { FanOutDialog } from "./FanOutDialog";
import { HomeDashboard, type ActivityEntry } from "./HomeDashboard";
import { ProjectContextMenu } from "./ProjectContextMenu";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { ProjectSidebar } from "./ProjectSidebar";
import { QuickOpenPalette } from "./QuickOpenPalette";
import { SessionContextMenu } from "./SessionContextMenu";
import { WorkspaceHeader, type SplitCandidate } from "./WorkspaceHeader";
import { WorkspaceSplit } from "./WorkspaceSplit";
import { WorktreeContextMenu } from "./WorktreeContextMenu";
import { WorktreeCreateDialog } from "./WorktreeCreateDialog";
import { fanOutTargets } from "@shared/fan-out";
import type { QuickOpenItem } from "./quick-open";
import { findAgent, newSessionLabel, projectName, sessionLabel } from "./session-labels";

type ActiveView = "home" | "detail" | "terminal";
const ACTIVITY_LOG_LIMIT = 20;

const DEFAULT_TERMINAL_SIZE = { cols: 80, rows: 24 };
const EMPTY_AVAILABILITY: ProviderAvailability = { vscode: false };
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

interface WorktreeMenuState {
  worktree: SharedWorktree;
  x: number;
  y: number;
}

interface WorktreeRemovalState {
  worktree: SharedWorktree;
  sessionCount: number;
}

/** The second, force-only confirmation after git refused because of uncommitted changes. */
interface WorktreeForceState {
  worktree: SharedWorktree;
  message: string;
}

interface DiffViewState {
  title: string;
  result: GitDiffResult;
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
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [agentWarning, setAgentWarning] = useState<string | null>(null);
  const agentsRef = useRef<AgentView[]>([]);
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
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [unread, setUnread] = useState<Record<string, SessionAttention>>({});
  const [worktrees, setWorktrees] = useState<SharedWorktree[]>([]);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [worktreeCreateProject, setWorktreeCreateProject] = useState<SharedProject | null>(null);
  const [worktreeMenu, setWorktreeMenu] = useState<WorktreeMenuState | null>(null);
  const [worktreeRemoval, setWorktreeRemoval] = useState<WorktreeRemovalState | null>(null);
  const [worktreeForce, setWorktreeForce] = useState<WorktreeForceState | null>(null);
  const [fanOutVisible, setFanOutVisible] = useState(false);
  const [diffView, setDiffView] = useState<DiffViewState | null>(null);
  const [splitSessionId, setSplitSessionId] = useState<string | null>(null);

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
  const selectedWorktree = worktrees.find((worktree) => worktree.id === selectedWorktreeId) ?? null;
  const splitSession = sessions.find((session) => session.id === splitSessionId) ?? null;
  const selectedSessionLabel = selectedSession
    ? sessionLabel(
        selectedSession,
        sessions.filter((session) => session.projectId === selectedSession.projectId),
        agents,
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

  const refreshAgents = useCallback(async () => {
    const snapshot = await window.multiCliWork.agents.list();
    setAgents(snapshot.agents);
    agentsRef.current = snapshot.agents;
    setAgentWarning(snapshot.warning ?? null);
  }, []);

  const loadWorkspace = useCallback(
    async (preservedSelection?: { projectId: string | null; sessionId: string | null; view?: ActiveView }) => {
      setLoading(true);
      setLoadError(null);
      const forceHome = preservedSelection?.view === "home";
      try {
        const [registrySnapshot, terminalSessions, providers, agentsSnapshot, appState, worktreeList] =
          await Promise.all([
            window.multiCliWork.projects.list(),
            window.multiCliWork.terminals.list(),
            window.multiCliWork.providers.availability(),
            window.multiCliWork.agents.list(),
            window.multiCliWork.terminals.state(),
            window.multiCliWork.worktrees.list(),
          ]);
        setWorktrees(worktreeList);
        setAgents(agentsSnapshot.agents);
        agentsRef.current = agentsSnapshot.agents;
        setAgentWarning(agentsSnapshot.warning ?? null);
        const visibleProjects = Object.values(registrySnapshot.registry.projects).sort(
          (left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER),
        );
        const preferredProjectId = preservedSelection ? preservedSelection.projectId : appState.state.selectedProjectId;
        const preferredSessionId = preservedSelection ? preservedSelection.sessionId : appState.state.selectedSessionId;
        const restoredSession = terminalSessions.find((session) => session.id === preferredSessionId) ?? null;

        // A maintenance session belongs to no folder, so restoring it must not fall back to the
        // first folder in the list the way a plain "nothing selected" state does.
        // The split only restores if its session still exists; a stale id silently collapses.
        const restoredSplitId =
          terminalSessions.find((session) => session.id === appState.state.splitSessionId)?.id ?? null;

        if (restoredSession?.projectId === null) {
          setSnapshot(registrySnapshot);
          setSessions(terminalSessions);
          setAvailability(providers);
          setExpandedProjects(new Set(visibleProjects.map((project) => project.id)));
          setSelectedProjectId(null);
          setSelectedSessionId(restoredSession.id);
          setSelectedWorktreeId(null);
          setSplitSessionId(restoredSplitId);
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
        setSelectedWorktreeId(initialSession?.worktreeId ?? null);
        setSplitSessionId(restoredSplitId);
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

  // Editing `agents.json` happens in someone else's editor, so there is no save to listen for.
  // Coming back to the window is the one moment we know to look again.
  useEffect(() => {
    const handleFocus = () => {
      void refreshAgents().catch(() => undefined);
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshAgents]);

  useEffect(() => {
    let disposed = false;
    void window.multiCliWork.attention
      .state()
      .then((state) => {
        if (!disposed) setUnread(state);
      })
      .catch(() => undefined);
    const unsubscribe = window.multiCliWork.attention.onEvent(setUnread);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  // Capture phase, because the terminal usually owns the keyboard: xterm swallows keydowns once
  // focused, so only a listener that runs ahead of it can make Ctrl+P the app's shortcut.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      event.stopPropagation();
      setQuickOpenVisible((visible) => !visible);
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

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
                  sessionLabel: sessionLabel(previous, peers, agentsRef.current),
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
    setSelectedWorktreeId(null);
    setActiveView("detail");
    setExpandedProjects((current) => new Set(current).add(projectId));
    setActionError(null);
    persistSelection(projectId, null);
  };

  const applySplit = (sessionId: string | null) => {
    setSplitSessionId(sessionId);
    void window.multiCliWork.terminals.split(sessionId).catch((error) => {
      setActionError(errorMessage(error));
    });
  };

  const selectSession = (session: TerminalSessionView) => {
    setSelectedProjectId(session.projectId);
    setSelectedSessionId(session.id);
    setSelectedWorktreeId(session.worktreeId ?? null);
    setActiveView("terminal");
    setActionError(null);
    // Promoting the split session to the primary pane would leave both panes showing it.
    if (session.id === splitSessionId) applySplit(null);
    persistSelection(session.projectId, session.id);
  };

  /** A worktree behaves like a sub-folder: selecting it opens the detail page scoped to it. */
  const selectWorktree = (worktree: SharedWorktree) => {
    setSelectedProjectId(worktree.projectId);
    setSelectedSessionId(null);
    setSelectedWorktreeId(worktree.id);
    setActiveView("detail");
    setExpandedProjects((current) => new Set(current).add(worktree.projectId));
    setActionError(null);
    persistSelection(worktree.projectId, null);
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

  const startSession = async (project: SharedProject, kind: TerminalKind, worktreeId?: string) => {
    if (isProjectMissing(project.id) || !findAgent(agents, kind)?.available) return;
    setPendingAction(true);
    setActionError(null);
    try {
      const created = await window.multiCliWork.terminals.create({
        projectId: project.id,
        kind,
        ...(worktreeId !== undefined ? { worktreeId } : {}),
        ...DEFAULT_TERMINAL_SIZE,
      });
      setSessions((current) => replaceSession(current, created));
      setSelectedProjectId(project.id);
      setSelectedSessionId(created.id);
      setSelectedWorktreeId(worktreeId ?? null);
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

  const editAgents = async () => {
    setActionError(null);
    try {
      await window.multiCliWork.agents.edit();
    } catch (error) {
      setActionError(errorMessage(error));
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

  const handleWorktreeCreated = (worktree: SharedWorktree) => {
    setWorktreeCreateProject(null);
    setWorktrees((current) => [...current, worktree]);
    selectWorktree(worktree);
  };

  const showDiff = async (target: { worktree: SharedWorktree } | { project: SharedProject }) => {
    setActionError(null);
    try {
      if ("worktree" in target) {
        const owner = projects.find((project) => project.id === target.worktree.projectId);
        setDiffView({
          title: owner ? `${projectName(owner)} · ${target.worktree.branch}` : target.worktree.branch,
          result: await window.multiCliWork.worktrees.gitDiff(target.worktree.id),
        });
      } else {
        setDiffView({
          title: projectName(target.project),
          result: await window.multiCliWork.projects.gitDiff(target.project.id),
        });
      }
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const requestWorktreeRemoval = (worktree: SharedWorktree) => {
    const sessionCount = sessions.filter((session) => session.worktreeId === worktree.id).length;
    if (sessionCount === 0) {
      void confirmWorktreeRemoval(worktree);
      return;
    }
    setWorktreeRemoval({ worktree, sessionCount });
  };

  const cleanupRemovedWorktree = (worktree: SharedWorktree) => {
    setWorktrees((current) => current.filter((candidate) => candidate.id !== worktree.id));
    setSessions((current) => current.filter((session) => session.worktreeId !== worktree.id));
    if (selectedWorktreeId === worktree.id) {
      setSelectedWorktreeId(null);
      setSelectedSessionId(null);
      setActiveView("detail");
      persistSelection(worktree.projectId, null);
    }
  };

  /** First attempt never forces: git refusing over uncommitted changes comes back as a `dirty`
   *  result, which opens the second, explicit discard confirmation instead of silently deleting. */
  const confirmWorktreeRemoval = async (worktree: SharedWorktree) => {
    setWorktreeRemoval(null);
    setPendingAction(true);
    setActionError(null);
    try {
      const result = await window.multiCliWork.worktrees.remove(worktree.id, false);
      if (result.removed) cleanupRemovedWorktree(worktree);
      else setWorktreeForce({ worktree, message: result.message });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingAction(false);
    }
  };

  const forceWorktreeRemoval = async (worktree: SharedWorktree) => {
    setWorktreeForce(null);
    setPendingAction(true);
    setActionError(null);
    try {
      const result = await window.multiCliWork.worktrees.remove(worktree.id, true);
      if (result.removed) cleanupRemovedWorktree(worktree);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingAction(false);
    }
  };

  const sendFanOut = async (inputs: Array<{ sessionId: string; data: string }>) => {
    setFanOutVisible(false);
    setActionError(null);
    try {
      await Promise.all(inputs.map((input) => window.multiCliWork.terminals.write(input.sessionId, input.data)));
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  // Ordered for the empty query: sessions (most recently active first), folders, then commands.
  const quickOpenItems = useMemo<QuickOpenItem[]>(() => {
    if (!quickOpenVisible) return [];
    const nameById = new Map(projects.map((project) => [project.id, projectName(project)]));
    const sessionItems = [...sessions]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session): QuickOpenItem => ({
        key: `session:${session.id}`,
        kind: "session",
        label: sessionLabel(
          session,
          sessions.filter((peer) => peer.projectId === session.projectId),
          agents,
        ),
        detail: session.projectId ? (nameById.get(session.projectId) ?? null) : "도구",
      }));
    const projectItems = projects.map(
      (project): QuickOpenItem => ({
        key: `project:${project.id}`,
        kind: "project",
        label: projectName(project),
        detail: project.rootPath,
      }),
    );
    const commandItems: QuickOpenItem[] = [
      { key: "command:home", kind: "command", label: "홈 대시보드 열기", detail: null },
      ...(selectedProject && !selectedProjectMissing
        ? agents
            .filter((agent) => agent.available)
            .map(
              (agent): QuickOpenItem => ({
                key: `command:new-session:${agent.id}`,
                kind: "command",
                label: newSessionLabel(agent),
                detail: projectName(selectedProject),
              }),
            )
        : []),
      { key: "command:edit-agents", kind: "command", label: "에이전트 추가 (agents.json)", detail: null },
      { key: "command:check-updates", kind: "command", label: "업데이트 확인", detail: null },
    ];
    return [...sessionItems, ...projectItems, ...commandItems];
  }, [quickOpenVisible, sessions, projects, agents, selectedProject, selectedProjectMissing]);

  const handleQuickOpenSelect = (item: QuickOpenItem) => {
    setQuickOpenVisible(false);
    const [prefix, ...rest] = item.key.split(":");
    if (prefix === "session") {
      const session = sessions.find((candidate) => candidate.id === rest.join(":"));
      if (session) selectSession(session);
    } else if (prefix === "project") {
      selectProject(rest.join(":"));
    } else if (item.key === "command:home") {
      openHome();
    } else if (item.key === "command:edit-agents") {
      void editAgents();
    } else if (item.key === "command:check-updates") {
      void window.multiCliWork.updates.check().catch((error) => setActionError(errorMessage(error)));
    } else if (rest[0] === "new-session" && selectedProject) {
      void startSession(selectedProject, rest.slice(1).join(":"));
    }
  };

  // The header mirrors whatever the sidebar has selected, except on the home dashboard: there it
  // would otherwise show a stale project/session left over from before "Home" was opened.
  const headerProject = activeView === "home" ? null : selectedProject;
  const headerSession = activeView === "home" ? null : selectedSession;
  const headerSessionLabel = activeView === "home" ? null : selectedSessionLabel;

  // Everything but the primary can fill the second pane — including exited sessions, whose
  // read-only scrollback is exactly what a side-by-side comparison wants.
  const splitCandidates = useMemo<SplitCandidate[]>(() => {
    if (!selectedSession) return [];
    const nameById = new Map(projects.map((project) => [project.id, projectName(project)]));
    return [...sessions]
      .filter((session) => session.id !== selectedSession.id)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => ({
        sessionId: session.id,
        label: sessionLabel(
          session,
          sessions.filter((peer) => peer.projectId === session.projectId),
          agents,
        ),
        detail: session.projectId ? (nameById.get(session.projectId) ?? null) : "도구",
      }));
  }, [selectedSession, sessions, projects, agents]);

  return (
    <div className="app-shell" style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <ProjectSidebar
        snapshot={snapshot}
        projects={projects}
        sessions={folderSessions}
        agents={agents}
        unread={unread}
        worktrees={worktrees}
        toolSessions={toolSessions}
        selectedProjectId={activeView === "home" ? null : selectedProjectId}
        selectedSessionId={activeView === "home" ? null : selectedSessionId}
        selectedWorktreeId={activeView === "home" ? null : selectedWorktreeId}
        onSelectWorktree={selectWorktree}
        onWorktreeContextMenu={(worktree, event) => {
          event.preventDefault();
          setWorktreeMenu({ worktree, x: event.clientX, y: event.clientY });
        }}
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
              agents,
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
          agents={agents}
          pendingAction={pendingAction}
          readOnly={Boolean(snapshot && !snapshot.writable)}
          splitActive={Boolean(splitSession)}
          splitCandidates={splitCandidates}
          onSplit={applySplit}
          onStartSession={(kind) =>
            selectedProject && void startSession(selectedProject, kind, selectedWorktree?.id)
          }
          onStartTool={(tool) => void startTool(tool)}
          onEditAgents={() => void editAgents()}
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

            {/* A broken agents.json costs the user their own agents, not the app — so say so. */}
            {agentWarning ? (
              <div className="action-error" role="alert">
                <TriangleAlert size={14} />
                <span>{agentWarning}</span>
                <button type="button" onClick={() => void editAgents()} aria-label="agents.json 열기">
                  agents.json 열기
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
            <WorkspaceSplit
              session={selectedSession}
              splitSession={splitSession}
              splitSessionLabel={
                splitSession
                  ? sessionLabel(
                      splitSession,
                      sessions.filter((peer) => peer.projectId === splitSession.projectId),
                      agents,
                    )
                  : null
              }
              onAttached={(attached) => setSessions((current) => mergeAttachedSession(current, attached))}
              onError={(message) => setActionError(message)}
              onCloseSplit={() => applySplit(null)}
            />
          ) : activeView === "detail" && selectedProject ? (
            <ProjectDetailPage
              key={selectedWorktree ? `${selectedProject.id}:${selectedWorktree.id}` : selectedProject.id}
              project={selectedProject}
              worktree={selectedWorktree}
              sessions={folderSessions.filter((session) =>
                selectedWorktree
                  ? session.worktreeId === selectedWorktree.id
                  : session.projectId === selectedProject.id,
              )}
              agents={agents}
              vscodeAvailable={availability.vscode}
              pendingAction={pendingAction}
              onSelectSession={selectSession}
              onStartSession={(kind) => void startSession(selectedProject, kind, selectedWorktree?.id)}
              onReveal={() =>
                void runProjectAction(() =>
                  selectedWorktree
                    ? window.multiCliWork.worktrees.reveal(selectedWorktree.id)
                    : window.multiCliWork.projects.reveal(selectedProject.id),
                )
              }
              onOpenInEditor={() =>
                void runProjectAction(() =>
                  selectedWorktree
                    ? window.multiCliWork.worktrees.openInEditor(selectedWorktree.id)
                    : window.multiCliWork.projects.openInEditor(selectedProject.id),
                )
              }
              onOpenOnGitHub={() => void runProjectAction(() => window.multiCliWork.projects.openOnGitHub(selectedProject.id))}
              onFanOut={() => setFanOutVisible(true)}
              onShowDiff={() =>
                void showDiff(selectedWorktree ? { worktree: selectedWorktree } : { project: selectedProject })
              }
              onProjectSaved={handleProjectSaved}
            />
          ) : (
            <HomeDashboard
              projects={projects}
              sessions={sessions}
              agents={agents}
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
          onCreateWorktree={() => setWorktreeCreateProject(contextMenu.project)}
          onRename={() => {
            setExpandedProjects((current) => new Set(current).add(contextMenu.project.id));
            setEditingProjectId(contextMenu.project.id);
          }}
          onRemove={() => requestRemoval(contextMenu.project)}
          onClose={() => setContextMenu(null)}
        />
      ) : null}

      {worktreeMenu ? (
        <WorktreeContextMenu
          branch={worktreeMenu.worktree.branch}
          x={worktreeMenu.x}
          y={worktreeMenu.y}
          vscodeAvailable={availability.vscode}
          onReveal={() =>
            void runProjectAction(() => window.multiCliWork.worktrees.reveal(worktreeMenu.worktree.id))
          }
          onOpenInEditor={() =>
            void runProjectAction(() => window.multiCliWork.worktrees.openInEditor(worktreeMenu.worktree.id))
          }
          onShowDiff={() => void showDiff({ worktree: worktreeMenu.worktree })}
          onRemove={() => requestWorktreeRemoval(worktreeMenu.worktree)}
          onClose={() => setWorktreeMenu(null)}
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

      {quickOpenVisible ? (
        <QuickOpenPalette
          items={quickOpenItems}
          onSelect={handleQuickOpenSelect}
          onClose={() => setQuickOpenVisible(false)}
        />
      ) : null}

      {worktreeCreateProject ? (
        <WorktreeCreateDialog
          project={worktreeCreateProject}
          onCreated={handleWorktreeCreated}
          onClose={() => setWorktreeCreateProject(null)}
        />
      ) : null}

      {worktreeRemoval ? (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="Worktree 제거">
            <h2>{worktreeRemoval.worktree.branch} worktree를 제거할까요?</h2>
            <p>
              이 worktree의 세션 {worktreeRemoval.sessionCount}개가 중지되고 스크롤백이 삭제됩니다. 커밋한 내용은
              브랜치로 저장소에 남습니다.
            </p>
            <footer className="confirm-dialog-actions">
              <button type="button" onClick={() => setWorktreeRemoval(null)}>
                취소
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={pendingAction}
                onClick={() => void confirmWorktreeRemoval(worktreeRemoval.worktree)}
              >
                제거
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {worktreeForce ? (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="Worktree 강제 제거">
            <h2>커밋되지 않은 변경이 있습니다</h2>
            <p>{worktreeForce.message} 강제 제거하면 이 변경은 되돌릴 수 없이 사라집니다.</p>
            <footer className="confirm-dialog-actions">
              <button type="button" onClick={() => setWorktreeForce(null)}>
                취소
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={pendingAction}
                onClick={() => void forceWorktreeRemoval(worktreeForce.worktree)}
              >
                변경을 버리고 강제 제거
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {fanOutVisible && selectedProject ? (
        <FanOutDialog
          projectName={projectName(selectedProject)}
          targets={fanOutTargets(sessions, selectedProject.id).map((session) => ({
            sessionId: session.id,
            label: sessionLabel(
              session,
              sessions.filter((peer) => peer.projectId === session.projectId),
              agents,
            ),
            detail: session.worktreeId
              ? (worktrees.find((worktree) => worktree.id === session.worktreeId)?.branch ?? "worktree")
              : "루트",
          }))}
          onSend={(inputs) => void sendFanOut(inputs)}
          onClose={() => setFanOutVisible(false)}
        />
      ) : null}

      {diffView ? <DiffView title={diffView.title} result={diffView.result} onClose={() => setDiffView(null)} /> : null}

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
