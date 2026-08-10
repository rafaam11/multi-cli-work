import type { AgentView } from "@shared/agent-types";
import { WORKSPACE_COUNT, type SlotViewState } from "@shared/app-state-types";
import type {
  GitChangeEntry,
  GitDiffResult,
  ProjectWorkspaceSnapshot,
  ProviderAvailability,
  SessionAttention,
  TerminalSessionView,
} from "@shared/api-types";
import type { FileExplorerTarget, FileTreeEntry } from "@shared/file-explorer-types";
import type { ActivePullRequestReview, PullRequestListItem } from "@shared/github-types";
import type { SharedProject } from "@shared/project-types";
import type { WorkProject, WorkProjectRegistryV1, WorkProjectRole } from "@shared/work-project-types";
import type { GitWorkspaceView, SharedWorktree } from "@shared/worktree-types";
import type { TerminalEvent, TerminalKind, ToolCommand } from "@shared/terminal-types";
import { FolderX, RefreshCw, SquareTerminal, TriangleAlert } from "lucide-react";
import {
  lazy,
  Suspense,
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
import type { GitDiffFile } from "./GitDiffPane";
import { GitGraphEmbed } from "./GitGraphEmbed";
import type { GitWorktreeOption } from "./GitPanel";
import { RightSidebar, type RightSidebarTab } from "./RightSidebar";
import { categorizeFile, fileTabId, type OpenFileTab } from "./file-tabs";
import { FileViewerPane } from "./FileViewerPane";
import { HtmlView } from "./HtmlView";
import { HomeDashboard, type ActivityEntry } from "./HomeDashboard";
import { ProjectContextMenu } from "./ProjectContextMenu";
import { ProjectDetailPage } from "./ProjectDetailPage";
import { ProjectSidebar } from "./ProjectSidebar";
import { PullRequestDetailView } from "./PullRequestDetailView";
import { QuickOpenPalette } from "./QuickOpenPalette";
import { SessionContextMenu } from "./SessionContextMenu";
import type { TerminalCommands } from "./TerminalPane";
import { TitleBar } from "./TitleBar";
import { buildTitleBarMenus, NEW_SESSION_PREFIX } from "./title-bar-menu";
import { WorkProjectDetailPage } from "./WorkProjectDetailPage";
import { WorkspaceHeader } from "./WorkspaceHeader";
import { WorkspaceGrid } from "./WorkspaceGrid";
import { LayoutPicker } from "./LayoutPicker";
import { PaneTabBar, type ViewTab } from "./PaneTabBar";
import { WorktreeContextMenu } from "./WorktreeContextMenu";
import { WorktreeCreateDialog } from "./WorktreeCreateDialog";
import { fanOutTargets } from "@shared/fan-out";
import type { QuickOpenItem } from "./quick-open";
import { findAgent, newSessionLabel, projectName, sessionLabel } from "./session-labels";
import { isFolderActive } from "./folder-status";
import { DEFAULT_LAYOUT_ID } from "./grid-layouts";
import {
  documentPaneId,
  isDocumentPaneId,
  type DocumentKind,
  type DocumentPane,
  type PaneContent,
} from "./pane-items";
import {
  appendSession,
  clampPage,
  clearSlot,
  normalizeSlots,
  pageOfSession,
  placeInSlot,
  removeSession,
  resolveView,
  setLayout,
  viewPageSize,
} from "./slot-view";

type ActiveView = "home" | "detail" | "work-project" | "terminal";

/**
 * A grid belongs to a surface, and a surface is either a folder (a project, or one of its
 * worktrees, or the tool sessions that belong to none) or one of the three workspaces. Folder
 * surfaces are keyed by a string so they can all live in one persisted record; the prefixes keep a
 * worktree's grid from colliding with a project id.
 */
const TOOLS_VIEW_KEY = "@tools";

function folderViewKeyOf(projectId: string | null, worktreeId: string | null): string {
  if (worktreeId) return `@worktree:${worktreeId}`;
  return projectId ?? TOOLS_VIEW_KEY;
}

const EMPTY_VIEW: SlotViewState = { layoutId: DEFAULT_LAYOUT_ID, slots: [] };

/** 작업공간1/2/3 always exist, even before anything has been dropped into them. */
function emptyWorkspaces(): SlotViewState[] {
  return Array.from({ length: WORKSPACE_COUNT }, () => ({ layoutId: DEFAULT_LAYOUT_ID, slots: [] }));
}

/**
 * Restores the saved workspaces, padded to the fixed three. A state file written before v1.14.0
 * has no workspaces at all but does carry `visibleSessionIds` — the panes that were on screen when
 * the app last closed. Those become 작업공간1, so the arrangement survives the upgrade instead of
 * vanishing into a version the user never asked for.
 */
function restoreWorkspaces(
  saved: readonly SlotViewState[] | undefined,
  legacyVisibleSessionIds: readonly string[] | undefined,
  paneIds: readonly string[],
): SlotViewState[] {
  const restored = emptyWorkspaces();
  const source = saved && saved.length > 0
    ? saved
    : legacyVisibleSessionIds && legacyVisibleSessionIds.length > 0
      ? [{ layoutId: DEFAULT_LAYOUT_ID, slots: [...legacyVisibleSessionIds] }]
      : [];
  source.slice(0, WORKSPACE_COUNT).forEach((view, index) => {
    restored[index] = normalizeSlots(view, [], { keep: paneIds });
  });
  return restored;
}

function restoreFolderViews(
  saved: Readonly<Record<string, SlotViewState>> | undefined,
  paneIds: readonly string[],
): Record<string, SlotViewState> {
  return Object.fromEntries(
    Object.entries(saved ?? {}).map(([key, view]) => [key, normalizeSlots(view, [], { keep: paneIds })]),
  );
}

// Monaco rides along with the diff pane, so it only loads the first time a diff actually opens.
const GitDiffPane = lazy(() => import("./GitDiffPane").then((module) => ({ default: module.GitDiffPane })));
const ACTIVITY_LOG_LIMIT = 20;

const DEFAULT_TERMINAL_SIZE = { cols: 80, rows: 24 };
const EMPTY_AVAILABILITY: ProviderAvailability = { vscode: false };
const DEFAULT_SIDEBAR_WIDTH = 264;
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 420;
const MIN_WORKSPACE_WIDTH = 480;
const SIDEBAR_RESIZER_WIDTH = 4;
const SIDEBAR_RAIL_WIDTH = 52;
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 280;
const MIN_RIGHT_SIDEBAR_WIDTH = 220;
const MAX_RIGHT_SIDEBAR_WIDTH = 480;
const RIGHT_SIDEBAR_RAIL_WIDTH = 36;
/**
 * Both tree layers persist which nodes are *collapsed*, so a folder or group added later starts
 * expanded rather than hidden. One writer for both keys — see `persistCollapsed`.
 */
const COLLAPSED_PROJECTS_KEY = "multi-cli-work.projects.v1";
const COLLAPSED_WORK_PROJECTS_KEY = "multi-cli-work.work-projects.v1";

function persistCollapsed(key: string, collapsed: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify({ version: 1, collapsed: [...collapsed] }));
  } catch { /* unavailable storage */ }
}

/**
 * A document opened from the right-hand sidebar. It takes a slot exactly like a terminal does, so
 * a diff can sit beside the session that produced it rather than replacing the whole workspace.
 * Files are not here: `openFileTabs` already holds their content, and their pane id points at it.
 */
type OpenDocument =
  | { id: string; kind: "diff"; file: GitDiffFile }
  | { id: string; kind: "graph"; target: FileExplorerTarget; targetLabel: string | null }
  | { id: string; kind: "pull-request"; projectId: string; remoteName: string; number: number; label: string };

function documentTargetKey(target: FileExplorerTarget): string {
  return `${target.kind}:${target.id}`;
}

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

interface SessionRemovalState {
  session: TerminalSessionView;
  label: string;
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
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(COLLAPSED_PROJECTS_KEY) ?? "{}") as { collapsed?: string[] };
      return new Set(stored.collapsed ?? []);
    } catch { return new Set(); }
  });
  const [workProjectRegistry, setWorkProjectRegistry] = useState<WorkProjectRegistryV1 | null>(null);
  const [selectedWorkProjectId, setSelectedWorkProjectId] = useState<string | null>(null);
  const [collapsedWorkProjectIds, setCollapsedWorkProjectIds] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(COLLAPSED_WORK_PROJECTS_KEY) ?? "{}") as { collapsed?: string[] };
      return new Set(stored.collapsed ?? []);
    } catch { return new Set(); }
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState(false);
  const [refreshRequests, setRefreshRequests] = useState<Record<string, number>>({});
  const [refreshingSessionIds, setRefreshingSessionIds] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);
  const [rightSidebarTab, setRightSidebarTab] = useState<RightSidebarTab>("files");
  /** Diffs, commit graphs and pull requests on the grid. Files live in `openFileTabs` instead. */
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [openFileTabs, setOpenFileTabs] = useState<OpenFileTab[]>([]);
  const [fileTabCloseRequest, setFileTabCloseRequest] = useState<OpenFileTab | null>(null);
  const fileWriteQueuesRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const pendingFileWriteCountsRef = useRef<Map<string, number>>(new Map());
  const [pendingFileAnchor, setPendingFileAnchor] = useState<{ tabId: string; anchor: string } | null>(null);
  const [executableRequest, setExecutableRequest] = useState<{ target: FileExplorerTarget; entry: FileTreeEntry; error: string | null; running: boolean } | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null);
  const [sessionRemoval, setSessionRemoval] = useState<SessionRemovalState | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [removal, setRemoval] = useState<RemovalState | null>(null);
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [unread, setUnread] = useState<Record<string, SessionAttention>>({});
  const [worktrees, setWorktrees] = useState<SharedWorktree[]>([]);
  const [activeReviews, setActiveReviews] = useState<ActivePullRequestReview[]>([]);
  const [workspaceViews, setWorkspaceViews] = useState<GitWorkspaceView[]>([]);
  const [worktreeWarnings, setWorktreeWarnings] = useState<Record<string, string>>({});
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [worktreeCreateProject, setWorktreeCreateProject] = useState<SharedProject | null>(null);
  const [worktreeMenu, setWorktreeMenu] = useState<WorktreeMenuState | null>(null);
  const [worktreeRemoval, setWorktreeRemoval] = useState<WorktreeRemovalState | null>(null);
  const [worktreeForce, setWorktreeForce] = useState<WorktreeForceState | null>(null);
  const [fanOutVisible, setFanOutVisible] = useState(false);
  const [diffView, setDiffView] = useState<DiffViewState | null>(null);
  /** Each folder's saved grid, keyed by `folderViewKeyOf`. */
  const [folderViews, setFolderViews] = useState<Record<string, SlotViewState>>({});
  /** 작업공간1/2/3, always three entries. */
  const [workspaces, setWorkspaces] = useState<SlotViewState[]>(emptyWorkspaces);
  /** Which workspace the grid is showing, or null while it shows a folder. */
  const [workspaceIndex, setWorkspaceIndex] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  /** The pane the keyboard and the outline follow — a session id or a document id. */
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);
  /** The folder a tab click just pointed at; the sidebar pulses it for three seconds. */
  const [flashProjectId, setFlashProjectId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set once the first load has published its arrangements, so an empty grid is never saved over. */
  const slotViewsRestored = useRef(false);
  const publishedSessionIds = useRef<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  /** Which terminal the 편집 menu acts on — a grid has several, and only focus tells them apart. */
  const [lastFocusedTerminalId, setLastFocusedTerminalId] = useState<string | null>(null);
  const terminalCommands = useRef(new Map<string, TerminalCommands>());
  /** Tray navigation subscribes once, so it reaches the current reveal through a ref. */
  const revealSessionRef = useRef<(session: TerminalSessionView) => void>(() => undefined);

  const projects = useMemo(() => {
    if (!snapshot) return [];
    return Object.values(snapshot.registry.projects).sort(
      (left, right) =>
        (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
        projectName(left).localeCompare(projectName(right)),
    );
  }, [snapshot]);

  const workProjects = useMemo(() => {
    if (!workProjectRegistry) return [];
    return Object.values(workProjectRegistry.workProjects).sort(
      (left, right) =>
        (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
        left.name.localeCompare(right.name),
    );
  }, [workProjectRegistry]);

  /** projectId → owning work project and role; folders absent from the map are 미분류. */
  const projectMembership = useMemo(() => {
    const map: Record<string, { workProjectId: string; role: WorkProjectRole }> = {};
    for (const workProject of workProjects) {
      for (const member of workProject.members) {
        map[member.projectId] = { workProjectId: workProject.id, role: member.role };
      }
    }
    return map;
  }, [workProjects]);

  const expandedWorkProjects = useMemo(
    () => new Set(workProjects.filter((workProject) => !collapsedWorkProjectIds.has(workProject.id)).map((workProject) => workProject.id)),
    [workProjects, collapsedWorkProjectIds],
  );

  const folderSessions = useMemo(() => sessions.filter((session) => session.projectId !== null), [sessions]);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const selectedWorkProject = workProjects.find((workProject) => workProject.id === selectedWorkProjectId) ?? null;
  const selectedWorkProjectMembers = useMemo(() => {
    if (!selectedWorkProject) return [];
    return projects
      .filter((project) => projectMembership[project.id]?.workProjectId === selectedWorkProject.id)
      .map((project) => ({ project, role: projectMembership[project.id].role }));
  }, [projects, projectMembership, selectedWorkProject]);
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? null;
  const selectedWorktree = worktrees.find((worktree) => worktree.id === selectedWorktreeId) ?? null;
  /** The file the keyboard is in — the pane with focus, when that pane is a file. */
  const selectedFileTab = openFileTabs.find((tab) => documentPaneId("file", tab.id) === focusedPaneId) ?? null;
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
    (projectId: string | null) => Boolean(projectId && snapshot?.missingRootProjectIds.includes(projectId)),
    [snapshot],
  );

  /**
   * Every open document as a pane: the file tabs and the diffs, graphs and pull requests opened from
   * the right sidebar. A slot holds one of these exactly as it holds a session.
   */
  const documentPanes = useMemo<DocumentPane[]>(
    () => [
      ...openFileTabs.map((tab) => ({
        id: documentPaneId("file", tab.id),
        kind: "file" as DocumentKind,
        label: tab.name,
        detail: tab.targetLabel,
        dirty: tab.dirty,
      })),
      ...documents.map((document) => {
        if (document.kind === "diff") {
          return {
            id: document.id,
            kind: "diff" as DocumentKind,
            label: document.file.path.split("/").at(-1) ?? document.file.path,
            detail: document.file.targetLabel,
            dirty: false,
          };
        }
        if (document.kind === "graph") {
          return {
            id: document.id,
            kind: "graph" as DocumentKind,
            label: "커밋 그래프",
            detail: document.targetLabel,
            dirty: false,
          };
        }
        return { id: document.id, kind: "pull-request" as DocumentKind, label: document.label, detail: null, dirty: false };
      }),
    ],
    [openFileTabs, documents],
  );
  const documentPaneIds = useMemo(() => documentPanes.map((pane) => pane.id), [documentPanes]);
  /** The pull request the focused pane shows, so the sidebar's list can mark it as the open one. */
  const focusedPullRequest =
    documents.find(
      (document): document is Extract<OpenDocument, { kind: "pull-request" }> =>
        document.kind === "pull-request" && document.id === focusedPaneId,
    ) ?? null;
  const folderViewKey = folderViewKeyOf(selectedProjectId, selectedWorktreeId);
  /** The grid on screen: one of the three workspaces, or the folder the sidebar has selected. */
  const currentView =
    workspaceIndex !== null
      ? (workspaces[workspaceIndex] ?? EMPTY_VIEW)
      : (folderViews[folderViewKey] ?? EMPTY_VIEW);
  const resolvedView = useMemo(() => resolveView(currentView, page), [currentView, page]);

  // Closing panes or picking a roomier layout can leave the last page behind; the grid already
  // draws a clamped page, and this keeps the stored one from springing back later.
  useEffect(() => {
    setPage((current) => clampPage(current, resolvedView.pages));
  }, [resolvedView.pages]);

  /**
   * What a folder surface is about: a worktree's own sessions, or a project's (its worktrees
   * included), or — for the tool surface, which belongs to no folder — the sessions with no project.
   */
  const surfaceSessions = useMemo(() => {
    if (workspaceIndex !== null) return [];
    if (selectedWorktreeId) return sessions.filter((session) => session.worktreeId === selectedWorktreeId);
    if (selectedProjectId) return sessions.filter((session) => session.projectId === selectedProjectId);
    return sessions.filter((session) => session.projectId === null);
  }, [sessions, selectedProjectId, selectedWorktreeId, workspaceIndex]);

  /** The sessions this page actually draws — what main reads to decide about notifications. */
  const visibleSessionIds = useMemo(
    () => resolvedView.slots.filter((id): id is string => id !== null && !isDocumentPaneId(id)),
    [resolvedView],
  );

  const rightSidebarSpace = rightSidebarCollapsed ? RIGHT_SIDEBAR_RAIL_WIDTH : rightSidebarWidth;

  const maximumSidebarWidth = useCallback(
    () =>
      Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(
          MAX_SIDEBAR_WIDTH,
          window.innerWidth - MIN_WORKSPACE_WIDTH - SIDEBAR_RESIZER_WIDTH - rightSidebarSpace - SIDEBAR_RESIZER_WIDTH,
        ),
      ),
    [rightSidebarSpace],
  );

  const clampSidebarWidth = useCallback(
    (width: number) => Math.min(maximumSidebarWidth(), Math.max(MIN_SIDEBAR_WIDTH, width)),
    [maximumSidebarWidth],
  );

  const leftSidebarSpace = sidebarCollapsed ? SIDEBAR_RAIL_WIDTH : sidebarWidth;

  const maximumRightSidebarWidth = useCallback(
    () =>
      Math.max(
        MIN_RIGHT_SIDEBAR_WIDTH,
        Math.min(
          MAX_RIGHT_SIDEBAR_WIDTH,
          window.innerWidth - MIN_WORKSPACE_WIDTH - SIDEBAR_RESIZER_WIDTH - leftSidebarSpace - SIDEBAR_RESIZER_WIDTH,
        ),
      ),
    [leftSidebarSpace],
  );

  const clampRightSidebarWidth = useCallback(
    (width: number) => Math.min(maximumRightSidebarWidth(), Math.max(MIN_RIGHT_SIDEBAR_WIDTH, width)),
    [maximumRightSidebarWidth],
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
        const [registrySnapshot, terminalSessions, providers, agentsSnapshot, appState, worktreeList, reviewList, workProjectList] =
          await Promise.all([
            window.multiCliWork.projects.list(),
            window.multiCliWork.terminals.list(),
            window.multiCliWork.providers.availability(),
            window.multiCliWork.agents.list(),
            window.multiCliWork.terminals.state(),
            window.multiCliWork.worktrees.list(),
            window.multiCliWork.github.activeReviews(),
            window.multiCliWork.workProjects.list(),
          ]);
        // The project registry is the primary sidebar data. Publish it before optional selection
        // restoration and Git enrichment so either concern cannot blank the whole tree.
        setSnapshot(registrySnapshot);
        setWorkProjectRegistry(workProjectList);
        setSessions(terminalSessions);
        setAvailability(providers);
        setLoading(false);
        setWorkspaceViews(Object.values(registrySnapshot.registry.projects).map((project) => ({
          workspaceKey: `project:${project.id}:main`,
          kind: "main",
          projectId: project.id,
          worktreeId: null,
          path: project.rootPath,
          branch: null,
          head: null,
          changedFileCount: 0,
          availability: "available",
          lockedReason: null,
          prunableReason: null,
        })));
        setWorktrees(worktreeList);
        setActiveReviews(reviewList);
        // Git discovery is project-scoped and must never hold the whole sidebar in a loading state.
        void window.multiCliWork.worktrees.sync().then(async (worktreeSnapshot) => {
          setWorkspaceViews(worktreeSnapshot.workspaces);
          setWorktreeWarnings(worktreeSnapshot.warnings);
          setWorktrees(await window.multiCliWork.worktrees.list());
        }).catch(() => undefined);
        setAgents(agentsSnapshot.agents);
        agentsRef.current = agentsSnapshot.agents;
        setAgentWarning(agentsSnapshot.warning ?? null);
        const visibleProjects = Object.values(registrySnapshot.registry.projects).sort(
          (left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER),
        );
        let savedWorkspaceKey: string | null = null;
        try { savedWorkspaceKey = localStorage.getItem("multi-cli-work.last-workspace.v1"); } catch { /* unavailable storage */ }
        const savedWorktree = !preservedSelection && savedWorkspaceKey?.startsWith("worktree:")
          ? worktreeList.find((worktree) => worktree.id === savedWorkspaceKey.slice("worktree:".length)) ?? null
          : null;
        const preferredProjectId = preservedSelection ? preservedSelection.projectId : savedWorktree?.projectId ?? appState.state.selectedProjectId;
        const preferredSessionId = preservedSelection ? preservedSelection.sessionId : appState.state.selectedSessionId;
        const restoredSession = terminalSessions.find((session) => session.id === preferredSessionId) ?? null;
        const paneIds = terminalSessions.map((session) => session.id);
        // A folder's grid catches up on the sessions it does not list yet, most recently active
        // first — the arrangement the user saved, plus whatever was started since.
        const recentIds = (matches: (session: TerminalSessionView) => boolean) =>
          terminalSessions
            .filter(matches)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .map((session) => session.id);
        const restoreViews = (key: string, sessionIds: string[]) => {
          const restored = restoreFolderViews(appState.state.folderViews, paneIds);
          restored[key] = normalizeSlots(restored[key], sessionIds, { autoAppend: true, keep: paneIds });
          setFolderViews(restored);
          setWorkspaces(restoreWorkspaces(appState.state.workspaces, appState.state.visibleSessionIds, paneIds));
          setWorkspaceIndex(null);
          setPage(0);
          slotViewsRestored.current = true;
        };

        // A maintenance session belongs to no folder, so restoring it must not fall back to the
        // first folder in the list the way a plain "nothing selected" state does.
        if (restoredSession?.projectId === null) {
          setSnapshot(registrySnapshot);
          setSessions(terminalSessions);
          setAvailability(providers);
          setExpandedProjects(new Set(visibleProjects.filter((project) => !collapsedProjectIds.has(project.id)).map((project) => project.id)));
          setSelectedProjectId(null);
          setSelectedSessionId(restoredSession.id);
          setSelectedWorktreeId(null);
          setFocusedPaneId(restoredSession.id);
          restoreViews(folderViewKeyOf(null, null), recentIds((session) => session.projectId === null));
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

        const initialWorktreeId =
          initialSession?.worktreeId ??
          (savedWorktree && savedWorktree.projectId === initialProject?.id ? savedWorktree.id : null);

        setSnapshot(registrySnapshot);
        setSessions(terminalSessions);
        setAvailability(providers);
        setExpandedProjects(new Set(visibleProjects.filter((project) => !collapsedProjectIds.has(project.id)).map((project) => project.id)));
        setSelectedProjectId(initialProject?.id ?? null);
        setSelectedSessionId(initialSession?.id ?? null);
        setSelectedWorktreeId(initialWorktreeId);
        setFocusedPaneId(initialSession?.id ?? null);
        restoreViews(
          folderViewKeyOf(initialProject?.id ?? null, initialWorktreeId),
          initialWorktreeId
            ? recentIds((session) => session.worktreeId === initialWorktreeId)
            : initialProject
              ? recentIds((session) => session.projectId === initialProject.id)
              : recentIds((session) => session.projectId === null),
        );
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

  // Only the 도움말 menu shows it, and it never changes while the app runs.
  useEffect(() => {
    void window.multiCliWork.updates.appVersion().then(setAppVersion).catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleWindowResize = () => {
      setSidebarWidth((current) => clampSidebarWidth(current));
      setRightSidebarWidth((current) => clampRightSidebarWidth(current));
    };
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [clampSidebarWidth, clampRightSidebarWidth]);

  // Editing `agents.json` happens in someone else's editor, so there is no save to listen for.
  // Coming back to the window is the one moment we know to look again.
  useEffect(() => {
    const handleFocus = () => {
      void refreshAgents().catch(() => undefined);
      void window.multiCliWork.worktrees.sync().then((next) => {
        setWorkspaceViews(next.workspaces);
        setWorktreeWarnings(next.warnings);
        return window.multiCliWork.worktrees.list();
      }).then(setWorktrees).catch(() => undefined);
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

  // Electron's default menu is gone, and its accelerators went with it. These are the few worth
  // keeping, on the same capture-phase listener as Ctrl+P and for the same reason. Ctrl+R is
  // deliberately absent: reloading the renderer by mistyping is far worse than one extra menu trip.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const controls = window.multiCliWork.window;
      const run = (action: () => void) => {
        event.preventDefault();
        event.stopPropagation();
        action();
      };
      if (event.key === "F11") return run(() => void controls.toggleFullScreen());
      if (event.key === "F12") return run(() => void controls.toggleDevTools());
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      // Shift matters only for the glyph: Ctrl+Shift+= is how "+" is typed on a US layout.
      if (event.key === "=" || event.key === "+") return run(() => void controls.zoom("in"));
      if (event.key === "-" || event.key === "_") return run(() => void controls.zoom("out"));
      if (event.key === "0") return run(() => void controls.zoom("reset"));
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

  // Same capture-phase reasoning as Ctrl+P above, plus it has to beat the browser's own save-page
  // dialog. Image, binary, and truncated files remain read-only.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "s") return;
      if (!selectedFileTab || !["markdown", "html", "text"].includes(selectedFileTab.category) || selectedFileTab.truncated || selectedFileTab.encoding !== "utf8") return;
      event.preventDefault();
      event.stopPropagation();
      if (selectedFileTab.dirty) void saveFileTab(selectedFileTab.id);
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [selectedFileTab]);

  useEffect(() => {
    if (
      !pendingFileAnchor ||
      selectedFileTab?.id !== pendingFileAnchor.tabId ||
      selectedFileTab.loading ||
      selectedFileTab.category !== "markdown"
    ) return;
    const frame = requestAnimationFrame(() => {
      document.getElementById(pendingFileAnchor.anchor)?.scrollIntoView?.({ block: "start" });
      setPendingFileAnchor((current) => (current === pendingFileAnchor ? null : current));
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingFileAnchor, selectedFileTab]);

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

  const beginRightSidebarResize = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      document.body.classList.add("sidebar-resizing");
      // The right sidebar is anchored to the window's right edge, so its width is the distance
      // from the pointer to that edge — the mirror image of the left sidebar's clientX tracking.
      const handleMouseMove = (moveEvent: MouseEvent) =>
        setRightSidebarWidth(clampRightSidebarWidth(window.innerWidth - moveEvent.clientX));
      const handleMouseUp = () => {
        document.body.classList.remove("sidebar-resizing");
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [clampRightSidebarWidth],
  );

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  // A session can be removed from anywhere — the sidebar, another pane, the title bar — so every
  // arrangement drops the slots whose session is gone. Document panes are left alone: they answer to
  // their own tab list, not to the session registry.
  useEffect(() => {
    const alive = new Set(sessions.map((session) => session.id));
    const prune = (view: SlotViewState): SlotViewState => {
      let next = view;
      for (const id of view.slots) {
        if (id !== null && !isDocumentPaneId(id) && !alive.has(id)) next = removeSession(next, id);
      }
      return next;
    };
    setFolderViews((current) => {
      let changed = false;
      const next: Record<string, SlotViewState> = {};
      for (const [key, view] of Object.entries(current)) {
        next[key] = prune(view);
        if (next[key] !== view) changed = true;
      }
      return changed ? next : current;
    });
    setWorkspaces((current) => {
      const next = current.map(prune);
      return next.some((view, index) => view !== current[index]) ? next : current;
    });
  }, [sessions]);

  // The single writer for "what is on screen": the sessions the current page draws. Notification
  // policy in main reads this, so it has to follow every slot, page and layout change.
  useEffect(() => {
    if (!slotViewsRestored.current) return;
    const key = visibleSessionIds.join(" ");
    if (publishedSessionIds.current === key) return;
    publishedSessionIds.current = key;
    void window.multiCliWork.terminals.setVisibleSessions(visibleSessionIds).catch((error) => {
      setActionError(errorMessage(error));
    });
  }, [visibleSessionIds]);

  // Arrangements are persisted whole, so a restart brings back the same slots and the same layouts.
  useEffect(() => {
    if (!slotViewsRestored.current) return;
    void window.multiCliWork.terminals.setSlotViews({ folderViews, workspaces }).catch(() => undefined);
  }, [folderViews, workspaces]);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  useEffect(
    () =>
      window.multiCliWork.terminals.onEvent((event) => {
        if (event.type === "data") return;
        // A session the renderer did not start itself — a lazy auto-resume in the other pane, a
        // jk-coding-cli spawn — still has to appear in the list.
        if (event.type === "created") {
          setSessions((current) => replaceSession(current, event.session));
          return;
        }
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

  /** The sessions of one folder, most recently active first — the order a grid fills itself in. */
  const folderSessionIds = useCallback(
    (matches: (session: TerminalSessionView) => boolean) =>
      sessionsRef.current
        .filter(matches)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map((session) => session.id),
    [],
  );

  const updateFolderView = useCallback((key: string, mutate: (view: SlotViewState) => SlotViewState) => {
    setFolderViews((current) => ({ ...current, [key]: mutate(current[key] ?? EMPTY_VIEW) }));
  }, []);

  const updateCurrentView = (mutate: (view: SlotViewState) => SlotViewState) => {
    if (workspaceIndex !== null) {
      setWorkspaces((current) => current.map((view, index) => (index === workspaceIndex ? mutate(view) : view)));
      return;
    }
    updateFolderView(folderViewKey, mutate);
  };

  /**
   * A folder's grid catches up on the sessions it does not list yet. This runs when a folder view
   * comes on screen and when one of its sessions is born — never on every render, so a slot emptied
   * by hand stays empty.
   */
  const catchUpFolder = (key: string, sessionIds: readonly string[]): SlotViewState => {
    const next = normalizeSlots(folderViews[key], sessionIds, { autoAppend: true, keep: documentPaneIds });
    setFolderViews((current) => ({ ...current, [key]: next }));
    return next;
  };

  /** Points the sidebar at a folder for three seconds — how a tab click says where it came from. */
  const flashFolder = (projectId: string | null) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashProjectId(projectId);
    if (!projectId) return;
    flashTimer.current = setTimeout(() => setFlashProjectId(null), 3000);
  };

  // Opening a folder means opening its work: the grid fills with that folder's sessions, and the
  // 상세 page is a click away in the header rather than a stop on the way.
  const selectProject = (projectId: string) => {
    try { localStorage.setItem("multi-cli-work.last-workspace.v1", `main:${projectId}`); } catch { /* unavailable storage */ }
    const view = catchUpFolder(
      folderViewKeyOf(projectId, null),
      folderSessionIds((session) => session.projectId === projectId),
    );
    const first = view.slots.find((id): id is string => id !== null && !isDocumentPaneId(id)) ?? null;
    setWorkspaceIndex(null);
    setPage(0);
    setSelectedProjectId(projectId);
    setSelectedSessionId(first);
    setSelectedWorktreeId(null);
    setFocusedPaneId(view.slots.find((id): id is string => id !== null) ?? null);
    setActiveView("terminal");
    setExpandedProjects((current) => new Set(current).add(projectId));
    setActionError(null);
    persistSelection(projectId, first);
  };

  /**
   * Shows a session in the grid it belongs to. A jump from Quick Open, the home dashboard or the tray
   * lands on that session's own folder view, on the page that holds it — nothing else is rearranged.
   */
  const revealSession = (session: TerminalSessionView) => {
    const key = folderViewKeyOf(session.projectId, session.worktreeId ?? null);
    let view = catchUpFolder(
      key,
      folderSessionIds((candidate) =>
        session.worktreeId
          ? candidate.worktreeId === session.worktreeId
          : candidate.projectId === session.projectId,
      ),
    );
    if (!view.slots.includes(session.id)) {
      view = appendSession(view, session.id);
      setFolderViews((current) => ({ ...current, [key]: view }));
    }
    setWorkspaceIndex(null);
    setPage(pageOfSession(view.slots, viewPageSize(view), session.id) ?? 0);
    setSelectedProjectId(session.projectId);
    setSelectedSessionId(session.id);
    setSelectedWorktreeId(session.worktreeId ?? null);
    setFocusedPaneId(session.id);
    setActiveView("terminal");
    setActionError(null);
    if (session.projectId) {
      const projectId = session.projectId;
      setExpandedProjects((current) => new Set(current).add(projectId));
    }
    flashFolder(session.projectId);
    persistSelection(session.projectId, session.id);
  };

  const selectSession = (session: TerminalSessionView) => revealSession(session);

  /** Pressing a pane moves the focus — the keyboard target and what the 세션 menu acts on. */
  const focusPane = (paneId: string) => {
    setFocusedPaneId(paneId);
    if (isDocumentPaneId(paneId)) return;
    const session = sessions.find((candidate) => candidate.id === paneId);
    if (!session || session.id === selectedSessionId) return;
    setSelectedProjectId(session.projectId);
    setSelectedSessionId(session.id);
    setSelectedWorktreeId(session.worktreeId ?? null);
    persistSelection(session.projectId, session.id);
  };

  /** A tab click goes to the page holding that pane, focuses it, and points at its folder. */
  const selectPane = (paneId: string) => {
    const target = pageOfSession(currentView.slots, viewPageSize(currentView), paneId);
    // A tab for a pane this view has no slot for — an orphaned document — gets one on the way.
    if (target === null) openPane(paneId);
    else setPage(target);
    focusPane(paneId);
    if (isDocumentPaneId(paneId)) return;
    const session = sessions.find((candidate) => candidate.id === paneId);
    if (session?.projectId) {
      const projectId = session.projectId;
      setExpandedProjects((current) => new Set(current).add(projectId));
      flashFolder(projectId);
    }
  };

  /** Page-relative slots are what the grid draws; the arrangement is addressed absolutely. */
  const absoluteSlot = (index: number) => resolvedView.page * viewPageSize(currentView) + index;

  /** Emptying a slot only takes the pane off screen — the session keeps running, the file stays open. */
  const clearSlotAt = (index: number) => {
    const paneId = resolvedView.slots[index] ?? null;
    updateCurrentView((view) => clearSlot(view, absoluteSlot(index)));
    if (paneId !== null && paneId === focusedPaneId) setFocusedPaneId(null);
  };

  /** Dropping onto a slot: two panes trade places, or an off-screen pane takes the empty slot. */
  const dropPaneOnSlot = (index: number, paneId: string) => {
    updateCurrentView((view) => placeInSlot(view, absoluteSlot(index), paneId));
    focusPane(paneId);
  };

  /**
   * Picking an arrangement is also picking how many panes fit, so a narrower layout pushes the rest
   * onto later pages rather than dropping them. Going back to the first page keeps the pane the user
   * was looking at in view — it is the one that stays put in every layout.
   */
  const chooseLayout = (layoutId: string) => {
    updateCurrentView((view) => setLayout(view, layoutId));
    setPage(0);
  };

  const selectWorkspace = (index: number) => {
    const view = workspaces[index] ?? EMPTY_VIEW;
    setWorkspaceIndex(index);
    setPage(0);
    setFocusedPaneId(view.slots.find((id): id is string => id !== null) ?? null);
    setActiveView("terminal");
    setActionError(null);
  };

  /** A workspace is filled by hand only: a dropped pane takes the first free slot, or a new page. */
  const dropPaneOnWorkspace = (index: number, paneId: string) => {
    setWorkspaces((current) => current.map((view, at) => (at === index ? appendSession(view, paneId) : view)));
  };

  useEffect(() => {
    revealSessionRef.current = revealSession;
  });

  useEffect(
    () =>
      window.multiCliWork.navigation.onSessionRequested((sessionId) => {
        const session = sessionsRef.current.find((candidate) => candidate.id === sessionId);
        if (session) revealSessionRef.current(session);
      }),
    [],
  );

  /** A worktree behaves like a sub-folder: selecting it fills the grid with its own sessions. */
  const selectWorktree = (worktree: SharedWorktree) => {
    try { localStorage.setItem("multi-cli-work.last-workspace.v1", `worktree:${worktree.id}`); } catch { /* unavailable storage */ }
    const view = catchUpFolder(
      folderViewKeyOf(worktree.projectId, worktree.id),
      folderSessionIds((session) => session.worktreeId === worktree.id),
    );
    const first = view.slots.find((id): id is string => id !== null && !isDocumentPaneId(id)) ?? null;
    setWorkspaceIndex(null);
    setPage(0);
    setSelectedProjectId(worktree.projectId);
    setSelectedSessionId(first);
    setSelectedWorktreeId(worktree.id);
    setFocusedPaneId(view.slots.find((id): id is string => id !== null) ?? null);
    setActiveView("terminal");
    setExpandedProjects((current) => new Set(current).add(worktree.projectId));
    setActionError(null);
    persistSelection(worktree.projectId, first);
  };

  const openHome = () => setActiveView("home");

  const toggleProject = (projectId: string) => {
    setExpandedProjects((current) => {
      const next = new Set(current);
      const collapsed = new Set(collapsedProjectIds);
      if (next.has(projectId)) { next.delete(projectId); collapsed.add(projectId); }
      else { next.add(projectId); collapsed.delete(projectId); }
      setCollapsedProjectIds(collapsed);
      persistCollapsed(COLLAPSED_PROJECTS_KEY, collapsed);
      return next;
    });
  };

  const toggleWorkProject = (workProjectId: string) => {
    setCollapsedWorkProjectIds((current) => {
      const next = new Set(current);
      if (next.has(workProjectId)) next.delete(workProjectId);
      else next.add(workProjectId);
      persistCollapsed(COLLAPSED_WORK_PROJECTS_KEY, next);
      return next;
    });
  };

  /**
   * The two layers store expansion differently — 폴더 keeps an expanded set alongside its persisted
   * collapsed set, while a work project's expanded set is derived from its collapsed set — so a
   * bulk action has to state what stays open for each and let this fill in both complements.
   */
  const applyExpansion = (expandedProjectIds: Set<string>, expandedWorkProjectIds: Set<string>) => {
    const collapsedProjects = new Set(
      projects.filter((project) => !expandedProjectIds.has(project.id)).map((project) => project.id),
    );
    const collapsedWorkProjects = new Set(
      workProjects.filter((workProject) => !expandedWorkProjectIds.has(workProject.id)).map((workProject) => workProject.id),
    );
    setExpandedProjects(expandedProjectIds);
    setCollapsedProjectIds(collapsedProjects);
    setCollapsedWorkProjectIds(collapsedWorkProjects);
    persistCollapsed(COLLAPSED_PROJECTS_KEY, collapsedProjects);
    persistCollapsed(COLLAPSED_WORK_PROJECTS_KEY, collapsedWorkProjects);
  };

  const expandAll = () =>
    applyExpansion(
      new Set(projects.map((project) => project.id)),
      new Set(workProjects.map((workProject) => workProject.id)),
    );

  const collapseAll = () => applyExpansion(new Set(), new Set());

  /** 작업중 folders stay open, and a group opens when it still owns one. Worktrees are left alone. */
  const expandWorking = () => {
    const working = projects.filter((project) =>
      isFolderActive(sessions.filter((session) => session.projectId === project.id)),
    );
    applyExpansion(
      new Set(working.map((project) => project.id)),
      new Set(
        working
          .map((project) => projectMembership[project.id]?.workProjectId)
          .filter((workProjectId): workProjectId is string => workProjectId !== undefined),
      ),
    );
  };

  const selectWorkProject = (workProjectId: string) => {
    setSelectedWorkProjectId(workProjectId);
    setActiveView("work-project");
    setActionError(null);
  };

  const createWorkProject = async () => {
    setActionError(null);
    try {
      const before = new Set(Object.keys(workProjectRegistry?.workProjects ?? {}));
      const registry = await window.multiCliWork.workProjects.create({ name: "새 프로젝트" });
      setWorkProjectRegistry(registry);
      const created = Object.values(registry.workProjects).find((workProject) => !before.has(workProject.id));
      if (created) selectWorkProject(created.id);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const moveProjectToWorkProject = async (projectId: string, workProjectId: string | null) => {
    setActionError(null);
    try {
      const current = projectMembership[projectId];
      if (workProjectId === null) {
        if (!current) return;
        setWorkProjectRegistry(await window.multiCliWork.workProjects.removeMember(current.workProjectId, projectId));
        return;
      }
      setWorkProjectRegistry(
        await window.multiCliWork.workProjects.addMember(workProjectId, projectId, current?.role ?? "repo"),
      );
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  const removeWorkProject = async (workProjectId: string) => {
    setActionError(null);
    try {
      setWorkProjectRegistry(await window.multiCliWork.workProjects.remove(workProjectId));
      setSelectedWorkProjectId((current) => (current === workProjectId ? null : current));
      setActiveView((current) => (current === "work-project" ? "home" : current));
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  /** Registering a member folder touches both registries; merge both results into state. */
  const handleMemberFolderAdded = (result: { project: SharedProject; workProjects: WorkProjectRegistryV1 }) => {
    setWorkProjectRegistry(result.workProjects);
    setSnapshot((current) =>
      current
        ? {
            ...current,
            registry: {
              ...current.registry,
              projects: { ...current.registry.projects, [result.project.id]: result.project },
            },
          }
        : current,
    );
    setExpandedProjects((current) => new Set(current).add(result.project.id));
  };

  const addProject = async () => {
    setActionError(null);
    try {
      const added = await window.multiCliWork.projects.addFolder();
      if (!added) return;
      const { project, worktreeId } = added;
      setSnapshot((current) =>
        current
          ? {
              ...current,
              registry: {
                ...current.registry,
                projects: { ...current.registry.projects, [project.id]: project },
              },
            }
          : current,
      );
      setExpandedProjects((current) => new Set(current).add(project.id));
      setSelectedProjectId(project.id);
      setSelectedSessionId(null);
      setSelectedWorktreeId(worktreeId);
      setActiveView("detail");
      persistSelection(project.id, null);
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
      // The new pane takes the next free slot of its folder's grid — nothing already on screen is
      // pushed off, which is the whole point of this release.
      revealSession(created);
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
      revealSession(created);
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

  // Every pane header drives these too, so the target is explicit and only defaults to the focus.
  const resumeSession = async (target: TerminalSessionView | null = selectedSession) => {
    if (!target) return;
    if (!target.tool && isProjectMissing(target.projectId)) return;
    setPendingAction(true);
    setActionError(null);
    try {
      const resumed = await window.multiCliWork.terminals.resume({
        sessionId: target.id,
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

  const stopSession = async (target: TerminalSessionView | null = selectedSession) => {
    if (!target) return;
    setPendingAction(true);
    setActionError(null);
    try {
      await window.multiCliWork.terminals.stop(target.id);
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingAction(false);
    }
  };

  /** Panes publish their xterm handles here as they mount, and withdraw them as they go. */
  const registerTerminalCommands = useCallback((sessionId: string, commands: TerminalCommands | null) => {
    if (commands) {
      terminalCommands.current.set(sessionId, commands);
      return;
    }
    terminalCommands.current.delete(sessionId);
    setLastFocusedTerminalId((current) => (current === sessionId ? null : current));
  }, []);

  const finishSessionRefresh = (sessionId: string) => {
    setRefreshingSessionIds((current) => {
      const next = new Set(current);
      next.delete(sessionId);
      return next;
    });
  };

  const refreshSession = async (sessionId: string) => {
    if (refreshingSessionIds.has(sessionId)) return;
    setActionError(null);
    setRefreshingSessionIds((current) => new Set(current).add(sessionId));

    const displayed = activeView === "terminal" && visibleSessionIds.includes(sessionId);
    if (displayed) {
      setRefreshRequests((current) => ({ ...current, [sessionId]: (current[sessionId] ?? 0) + 1 }));
      return;
    }

    try {
      const attachment = await window.multiCliWork.terminals.refresh(sessionId);
      setSessions((current) => mergeAttachedSession(current, attachment.session));
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      finishSessionRefresh(sessionId);
    }
  };

  const removeSessionById = async (session: TerminalSessionView) => {
    setPendingAction(true);
    setActionError(null);
    try {
      await window.multiCliWork.terminals.remove(session.id);
      setSessions((current) => current.filter((candidate) => candidate.id !== session.id));
      // Every arrangement drops the slot on its own once the session is gone; this only decides
      // where the focus lands.
      const remaining = visibleSessionIds.filter((paneId) => paneId !== session.id);
      if (focusedPaneId === session.id) setFocusedPaneId(remaining[0] ?? null);
      if (selectedSessionId === session.id) {
        // The focus falls to the first pane still standing; an empty grid keeps its launcher up.
        const nextPane = sessions.find((candidate) => candidate.id === remaining[0]) ?? null;
        setSelectedSessionId(nextPane?.id ?? null);
        if (!nextPane && !session.projectId) setActiveView("home");
        persistSelection(nextPane ? nextPane.projectId : session.projectId, nextPane?.id ?? null);
      }
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setPendingAction(false);
    }
  };

  const confirmSessionRemoval = async (session: TerminalSessionView) => {
    setSessionRemoval(null);
    await removeSessionById(session);
  };

  /**
   * Puts a pane on the grid being viewed — the first free slot, or a new one at the end. A document
   * opened from the right sidebar lands here exactly as a session does, which is what makes the two
   * interchangeable in a slot.
   */
  const openPane = (paneId: string) => {
    const next = appendSession(currentView, paneId);
    updateCurrentView(() => next);
    setPage(pageOfSession(next.slots, viewPageSize(next), paneId) ?? 0);
    setFocusedPaneId(paneId);
    setActiveView("terminal");
  };

  /** A closed document leaves every arrangement — unlike a session, it has no life off the grid. */
  const dropPaneEverywhere = (paneId: string) => {
    setFolderViews((current) =>
      Object.fromEntries(Object.entries(current).map(([key, view]) => [key, removeSession(view, paneId)])),
    );
    setWorkspaces((current) => current.map((view) => removeSession(view, paneId)));
    setFocusedPaneId((current) => (current === paneId ? null : current));
  };

  const openFile = (target: FileExplorerTarget, targetLabel: string, entry: FileTreeEntry): string => {
    if (entry.executable) {
      setExecutableRequest({ target, entry, error: null, running: false });
      return fileTabId(target, entry.relativePath);
    }
    const id = fileTabId(target, entry.relativePath);
    if (openFileTabs.some((tab) => tab.id === id)) {
      openPane(documentPaneId("file", id));
      return id;
    }
    const category = categorizeFile(entry.name, entry.extension);
    const tab: OpenFileTab = {
      id,
      target,
      targetLabel,
      relativePath: entry.relativePath,
      name: entry.name,
      extension: entry.extension,
      category,
      encoding: "utf8",
      content: null,
      originalContent: null,
      dirty: false,
      loading: category !== "unsupported",
      saving: false,
      loadError: null,
      saveError: null,
      truncated: false,
    };
    setOpenFileTabs((current) => [...current, tab]);
    openPane(documentPaneId("file", id));
    if (category === "unsupported") return id;
    void window.multiCliWork.workspaceFiles
      .readFile(target, entry.relativePath)
      .then((result) => {
        setOpenFileTabs((current) =>
          current.map((candidate) =>
            candidate.id === id
              ? {
                  ...candidate,
                  content: result.content,
                  originalContent: result.content,
                  encoding: result.encoding,
                  truncated: result.truncated,
                  loading: false,
                }
              : candidate,
          ),
        );
      })
      .catch((error) => {
        setOpenFileTabs((current) =>
          current.map((candidate) =>
            candidate.id === id ? { ...candidate, loading: false, loadError: errorMessage(error) } : candidate,
          ),
        );
      });
    return id;
  };

  const openRelativeFile = (sourceTab: OpenFileTab, relativePath: string, anchor: string | null) => {
    const name = relativePath.split("/").at(-1) ?? relativePath;
    const dot = name.lastIndexOf(".");
    const extension = dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLocaleLowerCase("en-US") : null;
    const tabId = openFile(sourceTab.target, sourceTab.targetLabel, {
      name,
      relativePath,
      kind: "file",
      extension,
      // A Markdown link may open a file, but it can never execute one.
      executable: false,
    });
    if (anchor) setPendingFileAnchor({ tabId, anchor });
  };

  const forceOpenFileTab = (tabId: string) => {
    const tab = openFileTabs.find((candidate) => candidate.id === tabId);
    if (!tab || tab.loading) return;
    setOpenFileTabs((current) => current.map((candidate) => candidate.id === tabId ? { ...candidate, loading: true, loadError: null } : candidate));
    void window.multiCliWork.workspaceFiles.readFile(tab.target, tab.relativePath).then((result) => {
      setOpenFileTabs((current) => current.map((candidate) => candidate.id === tabId ? (
        result.encoding === "utf8" && !result.truncated
          ? { ...candidate, category: "text", encoding: result.encoding, content: result.content, originalContent: result.content, truncated: false, loading: false }
          : { ...candidate, encoding: result.encoding, truncated: result.truncated, loading: false, loadError: result.truncated ? "파일이 너무 커서 강제로 열 수 없습니다." : "UTF-8 텍스트가 아니거나 바이너리 파일입니다." }
      ) : candidate));
    }).catch((error) => setOpenFileTabs((current) => current.map((candidate) => candidate.id === tabId ? { ...candidate, loading: false, loadError: errorMessage(error) } : candidate)));
  };

  const updateFileTabContent = (tabId: string, content: string) => {
    setOpenFileTabs((current) =>
      current.map((tab) => (tab.id === tabId ? { ...tab, content, dirty: content !== tab.originalContent } : tab)),
    );
  };

  const saveFileTab = (tabId: string, contentOverride?: string): Promise<boolean> => {
    const tab = openFileTabs.find((candidate) => candidate.id === tabId);
    const content = contentOverride ?? tab?.content;
    if (!tab || content === null || content === undefined || tab.truncated || tab.encoding !== "utf8" || !["markdown", "html", "text"].includes(tab.category)) return Promise.resolve(false);
    const pendingCount = (pendingFileWriteCountsRef.current.get(tabId) ?? 0) + 1;
    pendingFileWriteCountsRef.current.set(tabId, pendingCount);
    setOpenFileTabs((current) =>
      current.map((candidate) =>
        candidate.id === tabId
          ? {
              ...candidate,
              ...(contentOverride === undefined ? {} : { content, dirty: content !== candidate.originalContent }),
              saving: true,
              saveError: null,
            }
          : candidate,
      ),
    );
    const previous = fileWriteQueuesRef.current.get(tabId) ?? Promise.resolve(true);
    const write = previous.then(async () => {
      let succeeded = false;
      try {
        await window.multiCliWork.workspaceFiles.writeFile(tab.target, tab.relativePath, content);
        succeeded = true;
        setOpenFileTabs((current) =>
          current.map((candidate) =>
            candidate.id === tabId
              ? {
                  ...candidate,
                  originalContent: content,
                  dirty: candidate.content !== content,
                  saveError: null,
                }
              : candidate,
          ),
        );
      } catch (error) {
        setOpenFileTabs((current) =>
          current.map((candidate) =>
            candidate.id === tabId
              ? { ...candidate, dirty: candidate.content !== candidate.originalContent, saveError: errorMessage(error) }
              : candidate,
          ),
        );
      } finally {
        const remaining = Math.max(0, (pendingFileWriteCountsRef.current.get(tabId) ?? 1) - 1);
        if (remaining === 0) pendingFileWriteCountsRef.current.delete(tabId);
        else pendingFileWriteCountsRef.current.set(tabId, remaining);
        setOpenFileTabs((current) =>
          current.map((candidate) => (candidate.id === tabId ? { ...candidate, saving: remaining > 0 } : candidate)),
        );
      }
      return succeeded;
    });
    fileWriteQueuesRef.current.set(tabId, write);
    void write.finally(() => {
      if (fileWriteQueuesRef.current.get(tabId) === write) fileWriteQueuesRef.current.delete(tabId);
    });
    return write;
  };

  const closeFileTabImmediately = (tabId: string) => {
    setOpenFileTabs((current) => current.filter((tab) => tab.id !== tabId));
    dropPaneEverywhere(documentPaneId("file", tabId));
  };

  const requestCloseFileTab = (tab: OpenFileTab) => {
    if (tab.dirty) {
      setFileTabCloseRequest(tab);
      return;
    }
    closeFileTabImmediately(tab.id);
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

  const reorderProjects = async (orderedIds: string[]) => {
    setActionError(null);
    try {
      setSnapshot(await window.multiCliWork.projects.reorder(orderedIds));
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
    const workspaceItems = workspaceViews.map((workspace): QuickOpenItem => ({
      key: workspace.kind === "main" ? `workspace:main:${workspace.projectId}` : `workspace:worktree:${workspace.worktreeId}`,
      kind: "workspace",
      label: workspace.kind === "main" ? `${nameById.get(workspace.projectId) ?? "프로젝트"} · 메인` : workspace.branch ?? `detached @ ${workspace.head?.slice(0, 7) ?? "unknown"}`,
      detail: workspace.path,
    }));
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
    return [...sessionItems, ...workspaceItems, ...projectItems, ...commandItems];
  }, [quickOpenVisible, sessions, projects, workspaceViews, agents, selectedProject, selectedProjectMissing]);

  const handleQuickOpenSelect = (item: QuickOpenItem) => {
    setQuickOpenVisible(false);
    const [prefix, ...rest] = item.key.split(":");
    if (prefix === "session") {
      const session = sessions.find((candidate) => candidate.id === rest.join(":"));
      if (session) selectSession(session);
    } else if (prefix === "project") {
      selectProject(rest.join(":"));
    } else if (prefix === "workspace" && rest[0] === "main") {
      selectProject(rest.slice(1).join(":"));
    } else if (prefix === "workspace" && rest[0] === "worktree") {
      const worktree = worktrees.find((candidate) => candidate.id === rest.slice(1).join(":"));
      if (worktree) selectWorktree(worktree);
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

  /**
   * A workspace on screen replaces the folder identity in the header: it belongs to no single folder,
   * so it is named by what it gathers instead. Documents count toward the panes but not the folders —
   * the folder tally is about how many places the work in view comes from.
   */
  const headerWorkspace = useMemo(() => {
    if (activeView !== "terminal" || workspaceIndex === null) return null;
    const paneIds = currentView.slots.filter((id): id is string => id !== null);
    const folders = new Set(
      paneIds
        .map((id) => sessions.find((session) => session.id === id)?.projectId ?? null)
        .filter((projectId): projectId is string => projectId !== null),
    );
    return { index: workspaceIndex, paneCount: paneIds.length, folderCount: folders.size };
  }, [activeView, workspaceIndex, currentView, sessions]);

  // The right-hand file explorer follows whatever the sidebar has selected — a worktree takes
  // precedence over its owning project, mirroring how the sidebar itself scopes a worktree's tree.
  const fileExplorerOwnerProject = selectedWorktree
    ? (projects.find((project) => project.id === selectedWorktree.projectId) ?? null)
    : selectedProject;
  const fileExplorerTarget: FileExplorerTarget | null =
    activeView === "home"
      ? null
      : selectedWorktree
        ? { kind: "worktree", id: selectedWorktree.id }
        : selectedProject
          ? { kind: "project", id: selectedProject.id }
          : null;
  const fileExplorerTargetLabel = selectedWorktree
    ? `${fileExplorerOwnerProject ? projectName(fileExplorerOwnerProject) : "worktree"} · ${selectedWorktree.branch}`
    : fileExplorerOwnerProject
      ? projectName(fileExplorerOwnerProject)
      : null;

  // The git tab's worktree dropdown lists the owning project's main repo plus its worktrees;
  // picking one drives the same selection handlers as the left sidebar, so the whole right
  // sidebar (git tab and file explorer alike) follows.
  const gitWorktreeOptions: GitWorktreeOption[] = fileExplorerOwnerProject
    ? [
        { worktreeId: null, label: `메인 · ${projectName(fileExplorerOwnerProject)}` },
        ...worktrees
          .filter((worktree) => worktree.projectId === fileExplorerOwnerProject.id)
          .map((worktree) => ({ worktreeId: worktree.id, label: worktree.branch })),
      ]
    : [];
  const selectGitWorktreeOption = (worktreeId: string | null) => {
    if (!fileExplorerOwnerProject) return;
    if (worktreeId === null) {
      selectProject(fileExplorerOwnerProject.id);
      return;
    }
    const worktree = worktrees.find((candidate) => candidate.id === worktreeId);
    if (worktree) selectWorktree(worktree);
  };
  /** Opening a document twice moves the focus to the pane already holding it. */
  const openDocument = (document: OpenDocument) => {
    setDocuments((current) => (current.some((item) => item.id === document.id) ? current : [...current, document]));
    openPane(document.id);
  };

  const closeDocument = (paneId: string) => {
    setDocuments((current) => current.filter((document) => document.id !== paneId));
    dropPaneEverywhere(paneId);
  };

  const openGitDiff = (change: GitChangeEntry) => {
    if (!fileExplorerTarget) return;
    openDocument({
      id: documentPaneId("diff", `${documentTargetKey(fileExplorerTarget)}:${change.path}`),
      kind: "diff",
      file: {
        target: fileExplorerTarget,
        path: change.path,
        status: change.status,
        ...(change.renamedFrom !== undefined ? { renamedFrom: change.renamedFrom } : {}),
        targetLabel: fileExplorerTargetLabel,
      },
    });
  };
  const openGitGraph = () => {
    if (!fileExplorerTarget) return;
    openDocument({
      id: documentPaneId("graph", documentTargetKey(fileExplorerTarget)),
      kind: "graph",
      target: fileExplorerTarget,
      targetLabel: fileExplorerTargetLabel,
    });
  };
  const openPullRequest = (remoteName: string, item: PullRequestListItem) => {
    if (!fileExplorerOwnerProject) return;
    const owner = fileExplorerOwnerProject;
    openDocument({
      id: documentPaneId("pull-request", `${owner.id}:${remoteName}:${item.number}`),
      kind: "pull-request",
      projectId: owner.id,
      remoteName,
      number: item.number,
      label: `#${item.number} ${item.title}`,
    });
  };
  const refreshReviewWorkspace = async (sessionId?: string) => {
    const [nextSessions, nextWorktrees, nextViews, nextReviews] = await Promise.all([
      window.multiCliWork.terminals.list(), window.multiCliWork.worktrees.list(), window.multiCliWork.worktrees.sync(), window.multiCliWork.github.activeReviews(),
    ]);
    setSessions(nextSessions); setWorktrees(nextWorktrees); setWorkspaceViews(nextViews.workspaces); setWorktreeWarnings(nextViews.warnings); setActiveReviews(nextReviews);
    if (sessionId) { const session = nextSessions.find((item) => item.id === sessionId); if (session) selectSession(session); }
  };
  const finishActiveReview = async (review: ActivePullRequestReview, allowUnverifiedReview = false, discardChanges = false): Promise<void> => {
    try {
      const result = await window.multiCliWork.github.finishReview(review.id, { allowUnverifiedReview, discardChanges });
      if (result.state === "review-unverified" || result.state === "verification-unavailable") {
        if (window.confirm(`${result.message}\n그래도 정리하시겠습니까?`)) await finishActiveReview(review, true, discardChanges);
        return;
      }
      if (result.state === "dirty") {
        if (window.confirm(`${result.message}\n변경을 버리고 강제 제거하시겠습니까?`)) await finishActiveReview(review, true, true);
        return;
      }
      await refreshReviewWorkspace();
    } catch (error) { setActionError(errorMessage(error)); }
  };

  // Terminals only exist while the terminal view is up, so anything else empties the 편집 menu.
  // Before either pane has been clicked, the primary one is the obvious stand-in for "the terminal".
  const editTargetId =
    activeView === "terminal" ? (lastFocusedTerminalId ?? selectedSession?.id ?? null) : null;
  const canSaveFile = Boolean(
    selectedFileTab &&
      ["markdown", "html", "text"].includes(selectedFileTab.category) &&
      !selectedFileTab.truncated &&
      selectedFileTab.encoding === "utf8",
  );

  /** Every pane that already has a slot somewhere — the rest are orphans looking for one. */
  const placedPaneIds = useMemo(() => {
    const placed = new Set<string>();
    for (const view of Object.values(folderViews)) for (const id of view.slots) if (id) placed.add(id);
    for (const view of workspaces) for (const id of view.slots) if (id) placed.add(id);
    return placed;
  }, [folderViews, workspaces]);

  /**
   * The tab bar lists every pane this view can show, page or no page: the folder's sessions in
   * creation order, then the documents it holds — plus any document with no slot at all, so one
   * closed out of a grid is never stranded.
   */
  const viewTabs = useMemo<ViewTab[]>(() => {
    const onScreen = new Set(resolvedView.slots.filter((id): id is string => id !== null));
    const inWorkspace = workspaceIndex !== null;
    const nameById = new Map(projects.map((project) => [project.id, projectName(project)]));
    const sessionTab = (session: TerminalSessionView): ViewTab => ({
      id: session.id,
      kind: "session",
      label: sessionLabel(session, sessions.filter((peer) => peer.projectId === session.projectId), agents),
      detail: inWorkspace ? (session.projectId ? (nameById.get(session.projectId) ?? null) : "도구") : null,
      onScreen: onScreen.has(session.id),
      status: session.status,
      agent: session.kind,
    });
    const documentTab = (pane: DocumentPane): ViewTab => ({
      id: pane.id,
      kind: "document",
      label: pane.label,
      detail: inWorkspace ? pane.detail : null,
      onScreen: onScreen.has(pane.id),
      document: pane.kind,
      dirty: pane.dirty,
    });
    if (inWorkspace) {
      // A workspace holds only what was dropped into it, so its tabs are its slots, in slot order.
      return currentView.slots
        .filter((id): id is string => id !== null)
        .map((id) => {
          const pane = documentPanes.find((candidate) => candidate.id === id);
          if (pane) return documentTab(pane);
          const session = sessions.find((candidate) => candidate.id === id);
          return session ? sessionTab(session) : null;
        })
        .filter((tab): tab is ViewTab => tab !== null);
    }
    return [
      ...[...surfaceSessions]
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map(sessionTab),
      ...documentPanes
        .filter((pane) => currentView.slots.includes(pane.id) || !placedPaneIds.has(pane.id))
        .map(documentTab),
    ];
  }, [
    resolvedView,
    workspaceIndex,
    currentView,
    surfaceSessions,
    documentPanes,
    placedPaneIds,
    sessions,
    projects,
    agents,
  ]);

  /** Builds what a slot draws. The grid knows nothing about viewers; this is where they are chosen. */
  const paneContentFor = (paneId: string): PaneContent | null => {
    if (!isDocumentPaneId(paneId)) {
      const session = sessions.find((candidate) => candidate.id === paneId);
      return session ? { kind: "session", session } : null;
    }
    const pane = documentPanes.find((candidate) => candidate.id === paneId);
    if (!pane) return null;
    const fileTab = openFileTabs.find((tab) => documentPaneId("file", tab.id) === paneId);
    if (fileTab) {
      return {
        kind: "document",
        document: pane,
        content:
          fileTab.category === "html" ? (
            <HtmlView
              tab={fileTab}
              onChangeContent={(content) => updateFileTabContent(fileTab.id, content)}
              onSave={() => void saveFileTab(fileTab.id)}
              onClose={() => requestCloseFileTab(fileTab)}
            />
          ) : (
            <FileViewerPane
              tab={fileTab}
              onChangeContent={(content) => updateFileTabContent(fileTab.id, content)}
              onAutoSaveContent={(content) => void saveFileTab(fileTab.id, content)}
              onSave={() => void saveFileTab(fileTab.id)}
              onClose={() => requestCloseFileTab(fileTab)}
              onForceOpen={() => forceOpenFileTab(fileTab.id)}
              onOpenRelativePath={(relativePath, anchor) => openRelativeFile(fileTab, relativePath, anchor)}
            />
          ),
      };
    }
    const document = documents.find((candidate) => candidate.id === paneId);
    if (!document) return null;
    if (document.kind === "diff") {
      return {
        kind: "document",
        document: pane,
        content: (
          <Suspense fallback={<div className="git-diff-state">불러오는 중</div>}>
            <GitDiffPane file={document.file} onClose={() => closeDocument(paneId)} />
          </Suspense>
        ),
      };
    }
    if (document.kind === "graph") {
      return {
        kind: "document",
        document: pane,
        content: <GitGraphEmbed target={document.target} targetLabel={document.targetLabel} />,
      };
    }
    return {
      kind: "document",
      document: pane,
      content: (
        <PullRequestDetailView
          projectId={document.projectId}
          remoteName={document.remoteName}
          prNumber={document.number}
          onReviewOpened={(sessionId) => void refreshReviewWorkspace(sessionId)}
          onWorkspaceChanged={() => void refreshReviewWorkspace()}
        />
      ),
    };
  };

  const gridSlots = resolvedView.slots.map((paneId) => (paneId === null ? null : paneContentFor(paneId)));
  /** How many of this page's slots are filled — what 자동 arranges around. */
  const gridPaneCount = gridSlots.filter((slot) => slot !== null).length;

  const titleBarMenus = useMemo(
    () =>
      buildTitleBarMenus({
        agents,
        appVersion,
        project: headerProject ? { missing: selectedProjectMissing } : null,
        readOnly: Boolean(snapshot && !snapshot.writable),
        pendingAction,
        session: headerSession
          ? {
              status: headerSession.status,
              tool: headerSession.tool !== null,
              refreshing: refreshingSessionIds.has(headerSession.id),
            }
          : null,
        terminalFocused: editTargetId !== null,
        canSaveFile,
        sidebarCollapsed,
        rightSidebarCollapsed,
      }),
    [
      agents,
      appVersion,
      headerProject,
      selectedProjectMissing,
      snapshot,
      pendingAction,
      headerSession,
      refreshingSessionIds,
      editTargetId,
      canSaveFile,
      sidebarCollapsed,
      rightSidebarCollapsed,
    ],
  );

  // Same rule the window frame and the taskbar badge use: an approval outranks a plain input wait.
  const titleBarAttention: SessionAttention | null = useMemo(() => {
    const waits = Object.values(unread);
    return waits.includes("approval") ? "approval" : waits.length > 0 ? "input" : null;
  }, [unread]);

  const titleBarWorkProjectName =
    activeView === "work-project"
      ? (selectedWorkProject?.name ?? null)
      : headerProject
        ? (workProjects.find((workProject) => workProject.id === projectMembership[headerProject.id]?.workProjectId)
            ?.name ?? null)
        : null;

  const handleMenuAction = (id: string) => {
    if (id.startsWith(NEW_SESSION_PREFIX) && selectedProject) {
      void startSession(selectedProject, id.slice(NEW_SESSION_PREFIX.length), selectedWorktree?.id);
      return;
    }
    const terminal = editTargetId ? (terminalCommands.current.get(editTargetId) ?? null) : null;
    switch (id) {
      case "file.add-folder": void addProject(); break;
      case "file.add-work-project": void createWorkProject(); break;
      case "file.save": if (selectedFileTab) void saveFileTab(selectedFileTab.id); break;
      case "file.relink": void relinkProject(); break;
      // Not window.close(): ✕ hides to the tray, 종료 goes through the session-stop confirmation.
      case "file.quit": void window.multiCliWork.window.quit(); break;
      case "edit.copy": terminal?.copySelection(); break;
      case "edit.paste": terminal?.paste(); break;
      case "edit.select-all": terminal?.selectAll(); break;
      case "edit.clear": terminal?.clear(); break;
      case "view.toggle-sidebar": setSidebarCollapsed((value) => !value); break;
      case "view.toggle-right-sidebar": setRightSidebarCollapsed((value) => !value); break;
      case "view.quick-open": setQuickOpenVisible((visible) => !visible); break;
      case "view.zoom-in": void window.multiCliWork.window.zoom("in"); break;
      case "view.zoom-out": void window.multiCliWork.window.zoom("out"); break;
      case "view.zoom-reset": void window.multiCliWork.window.zoom("reset"); break;
      case "view.full-screen": void window.multiCliWork.window.toggleFullScreen(); break;
      case "view.reload": void window.multiCliWork.window.reload(); break;
      case "view.dev-tools": void window.multiCliWork.window.toggleDevTools(); break;
      case "session.resume": void resumeSession(); break;
      case "session.refresh": if (headerSession) void refreshSession(headerSession.id); break;
      case "session.stop": void stopSession(); break;
      // The header's trash button removes at once; a menu is easier to hit by accident, so this
      // takes the sidebar's confirm-first path instead.
      case "session.remove":
        if (selectedSession) setSessionRemoval({ session: selectedSession, label: selectedSessionLabel ?? "" });
        break;
      case "tools.claude-update": void startTool("claude-update"); break;
      case "tools.codex-update": void startTool("codex-update"); break;
      case "tools.edit-agents": void editAgents(); break;
      case "help.check-updates":
        void window.multiCliWork.updates.check().catch((error) => setActionError(errorMessage(error)));
        break;
      case "help.release-notes": void window.multiCliWork.updates.openReleases(); break;
      case "help.repository": void window.multiCliWork.updates.openRepository(); break;
    }
  };

  return (
    <div className="app-frame">
      <TitleBar
        menus={titleBarMenus}
        onAction={handleMenuAction}
        workProjectName={titleBarWorkProjectName}
        folderName={activeView === "work-project" ? null : headerProject ? projectName(headerProject) : null}
        attention={titleBarAttention}
        onQuickOpen={() => setQuickOpenVisible((visible) => !visible)}
      />
    <div
      className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${rightSidebarCollapsed ? "right-sidebar-collapsed" : ""}`}
      style={
        {
          "--sidebar-width": `${sidebarCollapsed ? SIDEBAR_RAIL_WIDTH : sidebarWidth}px`,
          "--right-sidebar-width": `${rightSidebarCollapsed ? RIGHT_SIDEBAR_RAIL_WIDTH : rightSidebarWidth}px`,
        } as CSSProperties
      }
    >
      <ProjectSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
        snapshot={snapshot}
        projects={projects}
        workProjects={workProjects}
        projectMembership={projectMembership}
        expandedWorkProjects={expandedWorkProjects}
        selectedWorkProjectId={activeView === "work-project" ? selectedWorkProjectId : null}
        onToggleWorkProject={toggleWorkProject}
        onSelectWorkProject={selectWorkProject}
        onCreateWorkProject={() => void createWorkProject()}
        onMoveProjectToWorkProject={(projectId, workProjectId) => void moveProjectToWorkProject(projectId, workProjectId)}
        sessions={sessions}
        unread={unread}
        worktrees={worktrees}
        activeReviews={activeReviews}
        workspaceViews={workspaceViews}
        worktreeWarnings={worktreeWarnings}
        selectedProjectId={activeView === "home" ? null : selectedProjectId}
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
        loading={loading}
        loadError={loadError}
        onReload={() => void loadWorkspace({ projectId: selectedProjectId, sessionId: selectedSessionId, view: activeView })}
        onAddProject={() => void addProject()}
        onSelectProject={selectProject}
        onToggleProject={toggleProject}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        onExpandWorking={expandWorking}
        onReorderProjects={(orderedIds) => void reorderProjects(orderedIds)}
        onProjectContextMenu={(project, event) => {
          event.preventDefault();
          setContextMenu({ project, x: event.clientX, y: event.clientY });
        }}
        onProjectSaved={handleProjectSaved}
        onCloseEditor={() => setEditingProjectId(null)}
        onRestoreBackup={() => void restoreFromBackup()}
        workspacePaneCounts={workspaces.map((view) => view.slots.filter((id) => id !== null).length)}
        selectedWorkspaceIndex={activeView === "terminal" ? workspaceIndex : null}
        onSelectWorkspace={selectWorkspace}
        onDropPaneOnWorkspace={dropPaneOnWorkspace}
        flashProjectId={flashProjectId}
        openFileTabs={openFileTabs}
        selectedFileTabId={selectedFileTab?.id ?? null}
        onSelectFileTab={(tab) => selectPane(documentPaneId("file", tab.id))}
        onCloseFileTab={requestCloseFileTab}
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
          workspace={headerWorkspace}
          selectedProject={headerProject}
          selectedSession={headerSession}
          selectedSessionLabel={headerSessionLabel}
          projectMissing={selectedProjectMissing}
          agents={agents}
          pendingAction={pendingAction}
          readOnly={Boolean(snapshot && !snapshot.writable)}
          detailActive={activeView === "detail"}
          onOpenDetail={() => setActiveView("detail")}
          onStartSession={(kind) =>
            selectedProject && void startSession(selectedProject, kind, selectedWorktree?.id)
          }
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
          ) : activeView === "terminal" && (gridPaneCount > 0 || viewTabs.length > 0) ? (
            <div className="workspace-panes">
              <LayoutPicker layoutId={currentView.layoutId} paneCount={gridPaneCount} onSelect={chooseLayout} />
              <PaneTabBar
                tabs={viewTabs}
                agents={agents}
                activePaneId={focusedPaneId}
                page={resolvedView.page}
                pageCount={resolvedView.pages}
                onSelect={selectPane}
                onPageChange={setPage}
              />
              <WorkspaceGrid
                layout={resolvedView.layout}
                slots={gridSlots}
                allSessions={sessions}
                agents={agents}
                focusedPaneId={focusedPaneId}
                renamingSessionId={renamingSessionId}
                refreshRequests={refreshRequests}
                refreshingSessionIds={refreshingSessionIds}
                pendingAction={pendingAction}
                isProjectMissing={isProjectMissing}
                onAttached={(attached) => setSessions((current) => mergeAttachedSession(current, attached))}
                onRefreshComplete={finishSessionRefresh}
                onError={(message) => setActionError(message)}
                onRegisterCommands={registerTerminalCommands}
                onTerminalFocused={setLastFocusedTerminalId}
                onFocusPane={focusPane}
                onResumeSession={(session) => void resumeSession(session)}
                onRefreshSession={(sessionId) => void refreshSession(sessionId)}
                onStopSession={(session) => void stopSession(session)}
                onClearSlot={clearSlotAt}
                onDropPane={dropPaneOnSlot}
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
                onStartRename={setRenamingSessionId}
                onRenameSession={(sessionId, name) => void renameSession(sessionId, name)}
                onCancelRename={() => setRenamingSessionId(null)}
              />
            </div>
          ) : activeView === "terminal" && workspaceIndex !== null ? (
            <section className="terminal-empty">
              <SquareTerminal size={22} />
              <h2>작업공간{workspaceIndex + 1}이 비어 있습니다</h2>
              <p>세션이나 문서 탭을 사이드바의 이 작업공간 행으로 끌어다 놓으세요.</p>
            </section>
          ) : activeView === "terminal" && selectedProject ? (
            <section className="terminal-empty">
              <SquareTerminal size={22} />
              <h2>{projectName(selectedProject)}에 세션이 없습니다</h2>
              <p>위 도구 모음에서 에이전트를 골라 첫 세션을 시작하세요.</p>
            </section>
          ) : activeView === "work-project" && selectedWorkProject ? (
            <WorkProjectDetailPage
              key={selectedWorkProject.id}
              workProject={selectedWorkProject}
              members={selectedWorkProjectMembers}
              teamsSyncRoot={workProjectRegistry?.teamsSyncRoot ?? null}
              sessions={folderSessions.filter((session) =>
                selectedWorkProjectMembers.some((member) => member.project.id === session.projectId),
              )}
              agents={agents}
              onSelectSession={selectSession}
              onSelectProject={selectProject}
              onRegistryChanged={setWorkProjectRegistry}
              onMemberFolderAdded={handleMemberFolderAdded}
              onRemoveWorkProject={() => {
                if (window.confirm(`"${selectedWorkProject.name}" 프로젝트를 삭제할까요? 폴더와 세션은 남습니다.`)) {
                  void removeWorkProject(selectedWorkProject.id);
                }
              }}
              onOpenNotion={(url) => void window.multiCliWork.shell.openExternal(url).catch((error) => setActionError(errorMessage(error)))}
              onRevealProject={(projectId) => void runProjectAction(() => window.multiCliWork.projects.reveal(projectId))}
              onRevealLocalFolder={(folderPath) =>
                void runProjectAction(() =>
                  window.multiCliWork.workProjects.revealLocalFolder(selectedWorkProject.id, folderPath),
                )
              }
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
              workProjects={workProjects}
              projectMembership={projectMembership}
              sessions={sessions}
              agents={agents}
              activityLog={activityLog}
              pendingAction={pendingAction}
              onSelectSession={selectSession}
              onSelectWorkProject={selectWorkProject}
              onStartSession={(project, kind) => void startSession(project, kind)}
              onStartTool={(tool) => void startTool(tool)}
            />
          )}
        </div>
      </main>

      <div
        className="right-sidebar-resizer"
        role="separator"
        aria-label="우측 사이드바 크기 조절"
        aria-orientation="vertical"
        aria-valuemin={MIN_RIGHT_SIDEBAR_WIDTH}
        aria-valuemax={maximumRightSidebarWidth()}
        aria-valuenow={rightSidebarWidth}
        onMouseDown={beginRightSidebarResize}
      />

      <RightSidebar
        collapsed={rightSidebarCollapsed}
        onToggleCollapse={() => setRightSidebarCollapsed((value) => !value)}
        activeTab={rightSidebarTab}
        onSelectTab={setRightSidebarTab}
        target={fileExplorerTarget}
        targetLabel={fileExplorerTargetLabel}
        selectedRelativePath={
          selectedFileTab &&
          fileExplorerTarget &&
          selectedFileTab.target.kind === fileExplorerTarget.kind &&
          selectedFileTab.target.id === fileExplorerTarget.id
            ? selectedFileTab.relativePath
            : null
        }
        onOpenFile={(entry) => fileExplorerTarget && openFile(fileExplorerTarget, fileExplorerTargetLabel ?? "", entry)}
        worktreeOptions={gitWorktreeOptions}
        onSelectWorktreeOption={selectGitWorktreeOption}
        onOpenDiff={openGitDiff}
        onOpenGraph={openGitGraph}
        projectId={fileExplorerOwnerProject?.id ?? null}
        selectedPullRequest={focusedPullRequest ? { projectId: focusedPullRequest.projectId, remoteName: focusedPullRequest.remoteName, prNumber: focusedPullRequest.number } : null}
        onOpenPullRequest={openPullRequest}
      />

      {contextMenu ? (
        <ProjectContextMenu
          projectName={projectName(contextMenu.project)}
          x={contextMenu.x}
          y={contextMenu.y}
          vscodeAvailable={availability.vscode}
          workProjectOptions={workProjects.map((workProject) => ({
            id: workProject.id,
            name: workProject.name,
            current: projectMembership[contextMenu.project.id]?.workProjectId === workProject.id,
          }))}
          onMoveToWorkProject={(workProjectId) => void moveProjectToWorkProject(contextMenu.project.id, workProjectId)}
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
          locked={Boolean(workspaceViews.find((view) => view.worktreeId === worktreeMenu.worktree.id)?.lockedReason)}
          stale={workspaceViews.find((view) => view.worktreeId === worktreeMenu.worktree.id)?.availability === "missing"}
          onSync={() => void loadWorkspace({ projectId: selectedProjectId, sessionId: selectedSessionId, view: activeView })}
          onFetch={() => void window.multiCliWork.git.fetch({ kind: "worktree", id: worktreeMenu.worktree.id }).then(() => loadWorkspace({ projectId: selectedProjectId, sessionId: selectedSessionId, view: activeView })).catch((error) => setActionError(errorMessage(error)))}
          onUnlock={() => void window.multiCliWork.worktrees.unlock(worktreeMenu.worktree.id).then(() => loadWorkspace({ projectId: selectedProjectId, sessionId: selectedSessionId, view: activeView })).catch((error) => setActionError(errorMessage(error)))}
          onCleanupStale={() => void window.multiCliWork.worktrees.cleanupStale(worktreeMenu.worktree.projectId).then((next) => { setWorkspaceViews(next.workspaces); setWorktreeWarnings(next.warnings); return window.multiCliWork.worktrees.list(); }).then(setWorktrees).catch((error) => setActionError(errorMessage(error)))}
          onRemove={() => requestWorktreeRemoval(worktreeMenu.worktree)}
          pullRequestNumber={activeReviews.find((review) => review.worktreeId === worktreeMenu.worktree.id)?.pullRequestNumber}
          onFinishReview={() => {
            const review = activeReviews.find((item) => item.worktreeId === worktreeMenu.worktree.id);
            if (review) void finishActiveReview(review);
          }}
          onClose={() => setWorktreeMenu(null)}
        />
      ) : null}

      {sessionMenu ? (
        <SessionContextMenu
          sessionLabel={sessionMenu.label}
          x={sessionMenu.x}
          y={sessionMenu.y}
          canResetName={Boolean(sessionMenu.session.name)}
          onRefresh={() => void refreshSession(sessionMenu.session.id)}
          onRename={() => setRenamingSessionId(sessionMenu.session.id)}
          onResetName={() => void renameSession(sessionMenu.session.id, null)}
          onRemove={() => setSessionRemoval({ session: sessionMenu.session, label: sessionMenu.label })}
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

      {fileTabCloseRequest ? (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="저장하지 않은 변경 사항">
            <h2>{fileTabCloseRequest.name}에 저장하지 않은 변경 사항이 있습니다</h2>
            <p>닫으면 이 변경 사항이 되돌릴 수 없이 사라집니다.</p>
            <footer className="confirm-dialog-actions">
              <button type="button" onClick={() => setFileTabCloseRequest(null)}>
                취소
              </button>
              <button
                type="button"
                onClick={async () => {
                  const tab = fileTabCloseRequest;
                  setFileTabCloseRequest(null);
                  if (await saveFileTab(tab.id)) closeFileTabImmediately(tab.id);
                }}
              >
                저장 후 닫기
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={() => {
                  const tab = fileTabCloseRequest;
                  setFileTabCloseRequest(null);
                  closeFileTabImmediately(tab.id);
                }}
              >
                변경 사항 버리기
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {executableRequest ? (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="EXE 실행 확인">
            <h2>이 프로그램을 실행할까요?</h2>
            <p>{executableRequest.entry.relativePath}</p>
            {executableRequest.error ? <p className="file-viewer-error" role="alert">{executableRequest.error}</p> : null}
            <footer className="confirm-dialog-actions">
              <button type="button" disabled={executableRequest.running} onClick={() => setExecutableRequest(null)}>취소</button>
              <button
                type="button"
                className="danger-button"
                disabled={executableRequest.running}
                onClick={() => {
                  const request = executableRequest;
                  setExecutableRequest({ ...request, running: true, error: null });
                  void window.multiCliWork.workspaceFiles.runExecutable(request.target, request.entry.relativePath)
                    .then(() => setExecutableRequest(null))
                    .catch((error) => setExecutableRequest((current) => current ? { ...current, running: false, error: errorMessage(error) } : null));
                }}
              >
                {executableRequest.running ? "실행 중" : "실행"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {sessionRemoval ? (
        <div className="modal-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="세션 제거">
            <h2>{sessionRemoval.label} 세션을 제거할까요?</h2>
            <p>이 세션이 중지되고 스크롤백이 되돌릴 수 없이 삭제됩니다.</p>
            <footer className="confirm-dialog-actions">
              <button type="button" onClick={() => setSessionRemoval(null)}>
                취소
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={pendingAction}
                onClick={() => void confirmSessionRemoval(sessionRemoval.session)}
              >
                제거
              </button>
            </footer>
          </div>
        </div>
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
    </div>
  );
}
