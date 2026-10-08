import type { AgentView } from "@shared/agent-types";
import { isWorkingWorktree } from "@shared/working-branches";
import type { SlotViewState } from "@shared/app-state-types";
import type { ProjectWorkspaceSnapshot, SessionAttention, TerminalSessionView } from "@shared/api-types";
import { type FileExplorerTarget } from "@shared/file-explorer-types";
import type { ActivePullRequestReview } from "@shared/github-types";
import type { SharedProject } from "@shared/project-types";
import type { WorkProjectRegistryV1, WorkProjectRole } from "@shared/work-project-types";
import { knownTags, tagsByWorkProject, type ProjectTagsV1 } from "@shared/project-tags-types";
import type { WorkspaceShellInfo, WorkspaceSnapshot } from "@shared/workspace-types";
import { pathStyleFor, resolveShellRefForPath, shellLinkKey } from "@shared/workspace-path";
import type { GitWorkspaceView, SharedWorktree } from "@shared/worktree-types";
import { FolderX, RefreshCw, SquareTerminal, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { DiffView } from "./DiffView";
import { FanOutDialog } from "./FanOutDialog";
import { SettingsDialog, type SettingsTab } from "./SettingsDialog";
import { GitGraphEmbed } from "./GitGraphEmbed";
import type { GitWorktreeOption } from "./GitPanel";
import { RightSidebar, type RightSidebarTab } from "./RightSidebar";
import { type OpenFileTab } from "./file-tabs";
import { FileViewerPane } from "./FileViewerPane";
import { HtmlView } from "./HtmlView";
import { HomeDashboard, type ActivityEntry } from "./HomeDashboard";
import { NewSessionLauncher } from "./NewSessionLauncher";
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
import { FolderStartPage } from "./FolderStartPage";
import { WorktreeContextMenu } from "./WorktreeContextMenu";
import { WorktreeCreateDialog } from "./WorktreeCreateDialog";
import { fanOutTargets } from "@shared/fan-out";
import type { QuickOpenItem } from "./quick-open";
import { projectName, sessionLabel } from "./session-labels";
import { resolveLayout } from "./grid-layouts";
import { paneContextOf, paneContextOfOwner, type PaneContext } from "./pane-context";
import { recentProjects } from "./recent-folders";
import { buildSessionPanelItems, type SessionScopeTarget } from "./session-panel";
import {
  documentPaneId,
  isDocumentPaneId,
  type DocumentKind,
  type DocumentPane,
  type PaneContent,
  type PaneRow,
} from "./pane-items";
import { SHELF_TEXT, type ShelfKind, type Shelves } from "./shelves";
import {
  appendSession,
  clampPage,
  normalizeSlots,
  pageOfSession,
  removeSession,
  resolveView,
  viewPageSize,
} from "./slot-view";
import { errorMessage } from "./ipc-error";
import { useConfirmDialog } from "./confirm-dialog";
import {
  folderViewKeyOf,
  EMPTY_VIEW,
  emptyShelves,
  EMPTY_AVAILABILITY,
  MIN_SIDEBAR_WIDTH,
  SIDEBAR_RAIL_WIDTH,
  MIN_RIGHT_SIDEBAR_WIDTH,
  RIGHT_SIDEBAR_RAIL_WIDTH,
  replaceSession,
  mergeAttachedSession,
  type ActiveView,
  type OpenDocument,
  type ContextMenuState,
  type RemovalState,
  type SessionMenuState,
  type RenameSurface,
  type WorktreeMenuState,
  type WorktreeRemovalState,
  type WorktreeForceState,
  type DiffViewState,
} from "./app/app-model";
import { useAppSettings } from "./app/use-app-settings";
import { useAppShortcuts } from "./app/use-app-shortcuts";
import { useSidebarLayout } from "./app/use-sidebar-layout";
import {
  FolderRemovalDialog,
  RunConfirmDialog,
  UnsavedFileDialog,
  WorktreeForceDialog,
  WorktreeRemovalDialog,
} from "./app/AppConfirmDialogs";
import { createDocumentActions } from "./app/document-actions";
import { createFileTabActions, type RunConfirmRequest } from "./app/file-tab-actions";
import { useFolderTree } from "./app/use-folder-tree";
import { useRemoteSizeOwners } from "./app/use-remote-size-owners";
import { createGridActions } from "./app/grid-actions";
import { buildQuickOpenItems } from "./app/quick-open-items";
import { createSessionActions } from "./app/session-actions";
import { createWorktreeActions } from "./app/worktree-actions";
import { LAST_WORKSPACE_KEY, planRestore } from "./app/restore-plan";
import { useTerminalEvents } from "./app/use-terminal-events";

// Monaco rides along with the diff pane, so it only loads the first time a diff actually opens.
const GitDiffPane = lazy(() => import("./GitDiffPane").then((module) => ({ default: module.GitDiffPane })));

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
  const [workProjectRegistry, setWorkProjectRegistry] = useState<WorkProjectRegistryV1 | null>(null);
  const [projectTags, setProjectTags] = useState<ProjectTagsV1 | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceSnapshot | null>(null);
  const [selectedWorkProjectId, setSelectedWorkProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [pendingAction, setPendingAction] = useState(false);
  const [refreshRequests, setRefreshRequests] = useState<Record<string, number>>({});
  const [refreshingSessionIds, setRefreshingSessionIds] = useState<Set<string>>(new Set());
  const {
    sidebarWidth,
    sidebarCollapsed,
    setSidebarCollapsed,
    rightSidebarWidth,
    rightSidebarCollapsed,
    setRightSidebarCollapsed,
    maximumSidebarWidth,
    maximumRightSidebarWidth,
    beginSidebarResize,
    beginRightSidebarResize,
  } = useSidebarLayout();
  const { appSettings, setAppSettings, appVersion } = useAppSettings();
  const remoteSizeOwners = useRemoteSizeOwners();
  const { keymap, handleMenuActionRef, keyActionEnabledRef } = useAppShortcuts(appSettings.keybindings);
  const [rightSidebarTab, setRightSidebarTab] = useState<RightSidebarTab>("files");
  /** Diffs, commit graphs and pull requests on the grid. Files live in `openFileTabs` instead. */
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [openFileTabs, setOpenFileTabs] = useState<OpenFileTab[]>([]);
  const [fileTabCloseRequest, setFileTabCloseRequest] = useState<OpenFileTab | null>(null);
  const fileWriteQueuesRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const pendingFileWriteCountsRef = useRef<Map<string, number>>(new Map());
  const [pendingFileAnchor, setPendingFileAnchor] = useState<{ tabId: string; anchor: string } | null>(null);
  // Shared by the exe row-click ("run") and the "연결 프로그램으로 열기" menu item ("open") — both end up
  // calling the same confirmed openEntry, just with different modal wording for what is about to happen.
  const [runConfirmRequest, setRunConfirmRequest] = useState<RunConfirmRequest | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [sessionMenu, setSessionMenu] = useState<SessionMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ sessionId: string; surface: RenameSurface } | null>(null);
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** 설정을 특정 탭으로 열 때만 값이 있다. */
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  const [diffView, setDiffView] = useState<DiffViewState | null>(null);
  /** Each folder's saved grid, keyed by `folderViewKeyOf`. */
  const [folderViews, setFolderViews] = useState<Record<string, SlotViewState>>({});
  /** 작업공간 and 숨김. Every session and document the app holds sits in exactly one of them. */
  const [shelves, setShelves] = useState<Shelves>(emptyShelves);
  /** Which shelf the grid is showing, or null while it shows a folder. */
  const [shelfKind, setShelfKind] = useState<ShelfKind | null>(null);
  const [page, setPage] = useState(0);
  /** The empty slot whose ＋ 새 세션 is open, and where its list hangs from. */
  /**
   * The open recent-folders launcher and where it points. A null `index` means it was opened from
   * the header rather than from a slot, so the session it starts joins the end of what is on screen
   * instead of taking a particular place in it.
   */
  const [newSessionSlot, setNewSessionSlot] = useState<{ index: number | null; x: number; y: number } | null>(null);
  /** The pane the keyboard and the outline follow — a session id or a document id. */
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);
  /** The folder a tab click just pointed at; the sidebar pulses it for three seconds. */
  const [flashProjectId, setFlashProjectId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set once the first load has published its arrangements, so an empty grid is never saved over. */
  const slotViewsRestored = useRef(false);
  const publishedSessionIds = useRef<string | null>(null);
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

  /** 업무 프로젝트 id → 태그. 사이드바가 태그 한 겹을 얹는 근거다. 사라진 행은 그냥 빠진다. */
  const tagsByWorkProjectId = useMemo(
    () => tagsByWorkProject(projectTags, workProjects.map((workProject) => workProject.id)),
    [projectTags, workProjects],
  );

  /** 상세 페이지 태그 편집기의 자동완성 후보 — 다른 업무 프로젝트가 이미 쓰고 있는 태그. */
  const tagSuggestions = useMemo(() => knownTags(tagsByWorkProjectId), [tagsByWorkProjectId]);

  /**
   * 워크스페이스 셸에서 만들어진 업무 프로젝트: id → 그 셸. 사이드바가 기본 묶기를 켜는
   * 근거이며, 대응하는 업무 프로젝트가 사라진 연결은 그냥 빠진다. 링크와 셸은 동기화와 같은
   * 키로 맞춘다 — `_archive`로 옮겨진 v2 Project도 저장된 링크 그대로 제 셸을 찾는다.
   */
  const workspaceShells = useMemo(() => {
    const map: Record<string, WorkspaceShellInfo> = {};
    if (!workspace) return map;
    const style = pathStyleFor(window.multiCliWork.platform);
    const shellByKey = new Map(
      workspace.shells.map((shell) => [shellLinkKey(shell.root, shell.channel, shell.shell, style), shell]),
    );
    for (const link of workspace.registry.shellLinks) {
      const shell = shellByKey.get(shellLinkKey(link.root, link.channel, link.shell, style));
      if (shell) map[link.workProjectId] = shell;
    }
    return map;
  }, [workspace]);

  /**
   * projectId → owning work project and role; folders absent from the map are 미분류.
   *
   * 우선순위는 **수동 멤버십 > 역인덱스 > 미분류**다. 어느 업무 프로젝트에도 없는 폴더만
   * 워크스페이스 역인덱스로 자리를 찾는다 — 방금 연 레포가 다음 동기화 전에도 제 셸 아래에
   * 서도록. 사용자가 옮겨 둔 자리는 이 경로가 절대 건드리지 않는다.
   */
  const projectMembership = useMemo(() => {
    const map: Record<string, { workProjectId: string; role: WorkProjectRole }> = {};
    for (const workProject of workProjects) {
      for (const member of workProject.members) {
        map[member.projectId] = { workProjectId: workProject.id, role: member.role };
      }
    }
    if (!workspace || workspace.registry.roots.length === 0) return map;
    const style = pathStyleFor(window.multiCliWork.platform);
    const lookup = { roots: workspace.registry.roots, repoOwners: workspace.repoOwners };
    const workProjectByRef = new Map(
      Object.entries(workspaceShells).map(([workProjectId, shell]) => [shell.ref, workProjectId]),
    );
    for (const project of projects) {
      if (map[project.id]) continue;
      const ref = resolveShellRefForPath(project.rootPath, lookup, style);
      const workProjectId = ref ? workProjectByRef.get(ref) : undefined;
      if (workProjectId && workProjects.some((workProject) => workProject.id === workProjectId)) {
        map[project.id] = { workProjectId, role: "repo" };
      }
    }
    return map;
  }, [workProjects, projects, workspace, workspaceShells]);

  const {
    expandedProjects,
    setExpandedProjects,
    collapsedProjectIds,
    expandedWorkProjects,
    expandProject,
    expandWorkProject,
    toggleProject,
    toggleWorkProject,
    expandAll,
    collapseAll,
    expandWorking,
  } = useFolderTree({ projects, workProjects, sessions, projectMembership });


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

  /** The selected folder's worktrees — 상세 page's 워크트리 카드 and its `sortedWorktrees` derive from this. */
  const selectedProjectWorktrees = useMemo(
    () => worktrees.filter((candidate) => candidate.projectId === selectedProject?.id && isWorkingWorktree(candidate, workspaceViews)),
    [worktrees, selectedProject?.id, workspaceViews],
  );
  /** worktreeId → session count, for the same card. */
  const worktreeSessionCounts = useMemo(
    () =>
      Object.fromEntries(
        worktrees.map((candidate) => [
          candidate.id,
          sessions.filter((session) => session.worktreeId === candidate.id).length,
        ]),
      ),
    [worktrees, sessions],
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
        owner: tab.target,
      })),
      ...documents.map((document) => {
        if (document.kind === "diff") {
          return {
            id: document.id,
            kind: "diff" as DocumentKind,
            label: document.file.path.split("/").at(-1) ?? document.file.path,
            detail: document.file.targetLabel,
            dirty: false,
            owner: document.file.target,
          };
        }
        if (document.kind === "graph") {
          return {
            id: document.id,
            kind: "graph" as DocumentKind,
            label: "커밋 그래프",
            detail: document.targetLabel,
            dirty: false,
            owner: document.target,
          };
        }
        // A pull request belongs to the folder whose remote it lives on — it has no worktree of
        // its own until a review workspace is created for it.
        return {
          id: document.id,
          kind: "pull-request" as DocumentKind,
          label: document.label,
          detail: null,
          dirty: false,
          owner: { kind: "project" as const, id: document.projectId },
        };
      }),
    ],
    [openFileTabs, documents],
  );
  const documentPaneIds = useMemo(() => documentPanes.map((pane) => pane.id), [documentPanes]);
  /**
   * Where each pane's work lives, for the folder line its header opens with. Keyed by pane id so the
   * grid can look one up without knowing whether the slot holds a terminal or a document.
   */
  /** 설정의 구분 목록 — 레일·카드·상세·패인 헤더가 같은 목록으로 색을 고른다. */
  const projectCategories = appSettings.projects.categories;
  const paneContexts = useMemo(() => {
    const sources = { projects, worktrees, workProjects, membership: projectMembership, categories: projectCategories };
    const map = new Map<string, PaneContext>();
    for (const session of sessions) map.set(session.id, paneContextOf(session, sources));
    for (const pane of documentPanes) {
      const context = paneContextOfOwner(pane.owner, sources);
      if (context) map.set(pane.id, context);
    }
    return map;
  }, [sessions, documentPanes, projects, worktrees, workProjects, projectMembership, projectCategories]);
  /** The pull request the focused pane shows, so the sidebar's list can mark it as the open one. */
  const focusedPullRequest =
    documents.find(
      (document): document is Extract<OpenDocument, { kind: "pull-request" }> =>
        document.kind === "pull-request" && document.id === focusedPaneId,
    ) ?? null;
  const folderViewKey = folderViewKeyOf(selectedProjectId, selectedWorktreeId);
  /** The grid on screen: one of the two shelves, or the folder the sidebar has selected. */
  const currentView =
    shelfKind !== null ? shelves[shelfKind] : (folderViews[folderViewKey] ?? EMPTY_VIEW);
  const resolvedView = useMemo(() => resolveView(currentView, page), [currentView, page]);

  // Closing panes or picking a roomier layout can leave the last page behind; the grid already
  // draws a clamped page, and this keeps the stored one from springing back later.
  useEffect(() => {
    setPage((current) => clampPage(current, resolvedView.pages));
  }, [resolvedView.pages]);

  /**
   * The panes this page is drawing. The sidebar dims every row that is not in here, so a session
   * paginated off the current page reads as still open but out of sight.
   */
  const onScreenPaneIds = useMemo(
    () => new Set(resolvedView.slots.filter((id): id is string => id !== null)),
    [resolvedView],
  );

  /** The sessions this page actually draws — what main reads to decide about notifications. */
  const visibleSessionIds = useMemo(
    () => resolvedView.slots.filter((id): id is string => id !== null && !isDocumentPaneId(id)),
    [resolvedView],
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
        const [registrySnapshot, terminalSessions, providers, agentsSnapshot, appState, worktreeList, reviewList, workProjectList, projectTagList, workspaceSnapshot] =
          await Promise.all([
            window.multiCliWork.projects.list(),
            window.multiCliWork.terminals.list(),
            window.multiCliWork.providers.availability(),
            window.multiCliWork.agents.list(),
            window.multiCliWork.terminals.state(),
            window.multiCliWork.worktrees.list(),
            window.multiCliWork.github.activeReviews(),
            window.multiCliWork.workProjects.list(),
            window.multiCliWork.projectTags.list(),
            window.multiCliWork.workspace.list(),
          ]);
        // The project registry is the primary sidebar data. Publish it before optional selection
        // restoration and Git enrichment so either concern cannot blank the whole tree.
        setSnapshot(registrySnapshot);
        setWorkProjectRegistry(workProjectList);
        setProjectTags(projectTagList);
        setWorkspace(workspaceSnapshot);
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
        let savedWorkspaceKey: string | null = null;
        try { savedWorkspaceKey = localStorage.getItem(LAST_WORKSPACE_KEY); } catch { /* unavailable storage */ }
        const plan = planRestore({
          projects: registrySnapshot.registry.projects,
          sessions: terminalSessions,
          worktrees: worktreeList,
          state: appState.state,
          preservedSelection,
          savedWorkspaceKey,
          collapsedProjectIds,
        });
        setExpandedProjects(plan.expandedProjects);
        setSelectedProjectId(plan.selectedProjectId);
        setSelectedSessionId(plan.selectedSessionId);
        setSelectedWorktreeId(plan.selectedWorktreeId);
        setFocusedPaneId(plan.focusedPaneId);
        setFolderViews(plan.folderViews);
        setShelves(plan.shelves);
        setShelfKind(null);
        setPage(0);
        slotViewsRestored.current = true;
        setActiveView(plan.activeView);
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

  // 워크스페이스 동기화(설정 창의 루트 추가·다시 읽기, 시작 시 백그라운드 동기화)는 업무 프로젝트와
  // 태그를 main에서 다시 쓴다. 알림이 오면 세 목록을 다시 읽어야 재시작 없이 사이드바가 따라온다.
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void Promise.all([
        window.multiCliWork.workProjects.list(),
        window.multiCliWork.projectTags.list(),
        window.multiCliWork.workspace.list(),
      ])
        .then(([workProjectList, projectTagList, workspaceSnapshot]) => {
          if (disposed) return;
          setWorkProjectRegistry(workProjectList);
          setProjectTags(projectTagList);
          setWorkspace(workspaceSnapshot);
        })
        .catch((error: unknown) => {
          if (!disposed) setActionError(errorMessage(error));
        });
    };
    const unsubscribe = window.multiCliWork.workspace.onChange(refresh);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

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
    setShelves((current) => {
      const active = prune(current.active);
      const hidden = prune(current.hidden);
      return active === current.active && hidden === current.hidden ? current : { active, hidden };
    });
  }, [sessions]);

  /**
   * 작업공간 shows everything the app is holding, so it catches up rather than being filled by hand:
   * a session started from anywhere, a session restored at launch, a document just opened. A pane
   * the user has moved to 숨김 is already accounted for and stays there — that shelf is the exception
   * list this pass reads, and without it "take this off 작업공간" could not exist at all.
   *
   * This is an effect rather than a call at each birth because the sessions restored on startup and
   * the ones another window starts have no call site here to hang off.
   */
  useEffect(() => {
    const paneIds = [...sessions.map((session) => session.id), ...documentPaneIds];
    setShelves((current) => {
      const missing = paneIds.filter(
        (id) => !current.active.slots.includes(id) && !current.hidden.slots.includes(id),
      );
      if (missing.length === 0) return current;
      return { ...current, active: missing.reduce((view, id) => appendSession(view, id), current.active) };
    });
  }, [sessions, documentPaneIds]);

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
    void window.multiCliWork.terminals
      .setSlotViews({ folderViews, workspace: shelves.active, hiddenPanes: shelves.hidden })
      .catch(() => undefined);
  }, [folderViews, shelves]);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  useTerminalEvents({
    setSessions,
    setFocusedPaneId,
    setSelectedSessionId,
    setWorkspaceViews,
    setWorktreeWarnings,
    setWorktrees,
    setActivityLog,
    sessionsRef,
    agentsRef,
  });

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
    try { localStorage.setItem(LAST_WORKSPACE_KEY, `main:${projectId}`); } catch { /* unavailable storage */ }
    const view = catchUpFolder(
      folderViewKeyOf(projectId, null),
      folderSessionIds((session) => session.projectId === projectId),
    );
    const first = view.slots.find((id): id is string => id !== null && !isDocumentPaneId(id)) ?? null;
    setShelfKind(null);
    setPage(0);
    setSelectedProjectId(projectId);
    setSelectedSessionId(first);
    setSelectedWorktreeId(null);
    setFocusedPaneId(view.slots.find((id): id is string => id !== null) ?? null);
    setActiveView("terminal");
    // 폴더를 여는 것은 그 폴더의 일을 보겠다는 뜻이라, 트리에서도 펼쳐진다.
    expandProject(projectId);
    setActionError(null);
    persistSelection(projectId, first);
  };

  /**
   * Gives a pane its slot in the folder grid it belongs to: the grid catches up on the sessions it
   * does not list yet, and the pane takes the next free slot if it has none. Nothing on screen
   * moves — going to the pane is a separate step, and only some callers want it.
   */
  const placeInFolderView = (target: {
    paneId: string;
    projectId: string | null;
    worktreeId: string | null;
  }): SlotViewState => {
    const key = folderViewKeyOf(target.projectId, target.worktreeId);
    const caughtUp = catchUpFolder(
      key,
      folderSessionIds((candidate) =>
        target.worktreeId
          ? candidate.worktreeId === target.worktreeId
          : candidate.projectId === target.projectId,
      ),
    );
    if (caughtUp.slots.includes(target.paneId)) return caughtUp;
    const view = appendSession(caughtUp, target.paneId);
    setFolderViews((current) => ({ ...current, [key]: view }));
    return view;
  };

  /**
   * Shows a pane in the folder grid it belongs to: switch to that folder, let its grid catch up,
   * give the pane a slot if it has none, and turn to the page holding it. Nothing else is rearranged.
   *
   * One pass, rather than `selectProject` followed by `openPane` — that pair would read a
   * `currentView` from before the switch and drop the pane into the folder being left behind.
   */
  const revealPane = (target: {
    paneId: string;
    projectId: string | null;
    worktreeId: string | null;
    session?: TerminalSessionView;
  }) => {
    const view = placeInFolderView(target);
    setShelfKind(null);
    setPage(pageOfSession(view.slots, viewPageSize(view), target.paneId) ?? 0);
    setSelectedProjectId(target.projectId);
    setSelectedWorktreeId(target.worktreeId);
    if (target.session) setSelectedSessionId(target.session.id);
    setFocusedPaneId(target.paneId);
    setActiveView("terminal");
    setActionError(null);
    // 가리킨 패인이 접힌 폴더 안이면 그 폴더를 펴 준다 — 아니면 깜빡임이 안 보이는 곳에서 난다.
    if (target.projectId) {
      const projectId = target.projectId;
      expandProject(projectId);
    }
    flashFolder(target.projectId);
    if (target.session) persistSelection(target.projectId, target.session.id);
  };

  /** A jump from Quick Open, the home dashboard, the sidebar or the tray lands on the session's folder. */
  const revealSession = (session: TerminalSessionView) =>
    revealPane({
      paneId: session.id,
      projectId: session.projectId,
      worktreeId: session.worktreeId ?? null,
      session,
    });

  /**
   * The same, for a document: it hangs under the place it was opened from, so that is the folder
   * view it returns to. A document with no owner — none exist today, but the field allows it — goes
   * to the no-folder surface rather than nowhere.
   */
  const revealDocument = (pane: DocumentPane) => {
    const owner = pane.owner;
    const worktree = owner?.kind === "worktree" ? worktrees.find((candidate) => candidate.id === owner.id) : null;
    revealPane({
      paneId: pane.id,
      projectId: owner?.kind === "project" ? owner.id : (worktree?.projectId ?? null),
      worktreeId: worktree?.id ?? null,
    });
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

  const {
    updateCurrentView,
    placePaneOnShelf,
    placePaneOnCurrentView,
    absoluteSlot,
    clearSlotAt,
    splitColumn,
    mergeColumn,
    snapPaneToZone,
    dropPaneOnSlot,
    chooseLayout,
    selectShelf,
    movePaneToShelf,
    placePaneOnShelfRow,
    movePaneToOtherShelf,
    revealShelfPane,
    openPaneOn,
    openPane,
    dropPaneEverywhere,
  } = createGridActions({
    shelfKind,
    folderViewKey,
    folderViews,
    shelves,
    currentView,
    resolvedView,
    focusedPaneId,
    setFolderViews,
    setShelves,
    setShelfKind,
    setPage,
    setFocusedPaneId,
    setActiveView,
    setActionError,
    updateFolderView,
    focusPane,
  });

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
    try { localStorage.setItem(LAST_WORKSPACE_KEY, `worktree:${worktree.id}`); } catch { /* unavailable storage */ }
    const view = catchUpFolder(
      folderViewKeyOf(worktree.projectId, worktree.id),
      folderSessionIds((session) => session.worktreeId === worktree.id),
    );
    const first = view.slots.find((id): id is string => id !== null && !isDocumentPaneId(id)) ?? null;
    setShelfKind(null);
    setPage(0);
    setSelectedProjectId(worktree.projectId);
    setSelectedSessionId(first);
    setSelectedWorktreeId(worktree.id);
    setFocusedPaneId(view.slots.find((id): id is string => id !== null) ?? null);
    setActiveView("terminal");
    expandProject(worktree.projectId);
    setActionError(null);
    persistSelection(worktree.projectId, first);
  };

  const openHome = () => setActiveView("home");

  const selectWorkProject = (workProjectId: string) => {
    setSelectedWorkProjectId(workProjectId);
    setActiveView("work-project");
    // Opening a group is also a request to see what it holds, so it unfolds.
    expandWorkProject(workProjectId);
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
    expandProject(result.project.id);
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
      expandProject(project.id);
      setSelectedProjectId(project.id);
      setSelectedSessionId(null);
      setSelectedWorktreeId(worktreeId);
      setActiveView("detail");
      persistSelection(project.id, null);
    } catch (error) {
      setActionError(errorMessage(error));
    }
  };

  /**
   * Why the sidebar menus' 새 세션 block cannot run right now, or null when it can. A folder whose
   * root went missing has nowhere to start a shell, and a launch already in flight would be lost to
   * the `pendingAction` guard — the menu says which it is instead of going quiet.
   */
  const newSessionDisabledReason = useCallback(
    (projectId: string): string | null => {
      if (isProjectMissing(projectId)) return "폴더를 찾을 수 없습니다";
      if (pendingAction) return "다른 작업이 끝난 뒤에 시작할 수 있습니다";
      return null;
    },
    [isProjectMissing, pendingAction],
  );

  /** The folder a worktree belongs to — a session needs it, since the worktree only narrows the cwd. */
  const worktreeMenuProject = worktreeMenu
    ? (projects.find((project) => project.id === worktreeMenu.worktree.projectId) ?? null)
    : null;

  /** Panes publish their xterm handles here as they mount, and withdraw them as they go. */
  const registerTerminalCommands = useCallback((sessionId: string, commands: TerminalCommands | null) => {
    if (commands) {
      terminalCommands.current.set(sessionId, commands);
      return;
    }
    terminalCommands.current.delete(sessionId);
    setLastFocusedTerminalId((current) => (current === sessionId ? null : current));
  }, []);

  const {
    startSession,
    startSessionInBackground,
    startSessionInSlot,
    startSessionFromHeader,
    startTool,
    editAgents,
    resumeSession,
    stopSession,
    finishSessionRefresh,
    refreshSession,
    refreshVisibleSessions,
    removeSessionById,
  } = createSessionActions({
    agents,
    isProjectMissing,
    setPendingAction,
    setActionError,
    setSessions,
    revealSession,
    placeInFolderView,
    flashFolder,
    placePaneOnCurrentView,
    absoluteSlot,
    focusPane,
    shelfKind,
    selectedProject,
    selectedWorktree,
    focusedPaneId,
    sessions,
    projects,
    selectedSession,
    persistSelection,
    refreshingSessionIds,
    setRefreshingSessionIds,
    activeView,
    visibleSessionIds,
    setRefreshRequests,
    setFocusedPaneId,
    selectedSessionId,
    setSelectedSessionId,
    setActiveView,
  });

  const {
    openFile,
    openWithOs,
    openRelativeFile,
    forceOpenFileTab,
    updateFileTabContent,
    saveFileTab,
    closeFileTabImmediately,
    requestCloseFileTab,
    closeFileTabsUnder,
    moveFileTabs,
  } = createFileTabActions({
    openFileTabs,
    setOpenFileTabs,
    appSettings,
    openPane,
    dropPaneEverywhere,
    setRunConfirmRequest,
    setPendingFileAnchor,
    setFileTabCloseRequest,
    setActionError,
    setFolderViews,
    setShelves,
    setFocusedPaneId,
    fileWriteQueuesRef,
    pendingFileWriteCountsRef,
  });

  const renameSession = async (sessionId: string, name: string | null) => {
    setRenameTarget(null);
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

  const relinkProject = async (project: SharedProject) => {
    setActionError(null);
    try {
      const relinked = await window.multiCliWork.projects.relink(project.id);
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
  // The title-bar menu, header button and missing-root banner all act on the selected folder;
  // the sidebar context menu is the one entry that names its folder directly.
  const relinkSelectedProject = () => {
    if (selectedProject) void relinkProject(selectedProject);
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

  const {
    handleWorktreeCreated,
    showDiff,
    requestWorktreeRemoval,
    confirmWorktreeRemoval,
    forceWorktreeRemoval,
  } = createWorktreeActions({
    setWorktreeCreateProject,
    setWorktrees,
    selectWorktree,
    setActionError,
    projects,
    setDiffView,
    sessions,
    setWorktreeRemoval,
    setSessions,
    selectedWorktreeId,
    setSelectedWorktreeId,
    setSelectedSessionId,
    setActiveView,
    persistSelection,
    setPendingAction,
    setWorktreeForce,
  });

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
  const quickOpenItems = useMemo<QuickOpenItem[]>(
    () =>
      quickOpenVisible
        ? buildQuickOpenItems({
            sessions,
            projects,
            workspaceViews,
            workProjects,
            tagsByWorkProjectId,
            agents,
            selectedProject: selectedProjectMissing ? null : selectedProject,
          })
        : [],
    [
      quickOpenVisible,
      sessions,
      projects,
      workspaceViews,
      workProjects,
      tagsByWorkProjectId,
      agents,
      selectedProject,
      selectedProjectMissing,
    ],
  );

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
    } else if (prefix === "work-project") {
      selectWorkProject(rest.join(":"));
    } else if (item.key === "command:home") {
      openHome();
    } else if (item.key === "command:edit-agents") {
      void editAgents();
    } else if (item.key === "command:check-updates") {
      void window.multiCliWork.updates.check().catch((error) => setActionError(errorMessage(error)));
    } else if (item.key === "command:settings") {
      setSettingsOpen(true);
      return;
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
   * The folder the grid is actually showing. Narrower than the highlighted row — that stays lit
   * behind a 상세 page, a worktree or a 작업공간 — and it is the only case where clicking the row
   * again says "I am already here", which the tree answers by folding it away.
   */
  const gridProjectId =
    activeView === "terminal" && shelfKind === null && selectedWorktreeId === null
      ? selectedProjectId
      : null;

  /**
   * A shelf on screen replaces the folder identity in the header: it belongs to no single folder, so
   * it is named by what it gathers instead. Documents count toward the panes but not the folders —
   * the folder tally is about how many places the work in view comes from.
   */
  const headerWorkspace = useMemo(() => {
    if (activeView !== "terminal" || shelfKind === null) return null;
    const paneIds = currentView.slots.filter((id): id is string => id !== null);
    const folders = new Set(
      paneIds
        .map((id) => sessions.find((session) => session.id === id)?.projectId ?? null)
        .filter((projectId): projectId is string => projectId !== null),
    );
    return { kind: shelfKind, paneCount: paneIds.length, folderCount: folders.size };
  }, [activeView, shelfKind, currentView, sessions]);

  /**
   * What the header's 제거 button acts on, and what its launchers aim at on a shelf: the session
   * behind the focused pane. A document pane has nothing to delete — it closes from its own viewer —
   * so the button steps aside for one.
   *
   * A tool session belongs to no folder, so there is nothing for a launcher to start beside it; that
   * is a reason of its own rather than a missing folder.
   */
  const headerFocusedSession = useMemo(() => {
    if (activeView !== "terminal" || focusedPaneId === null || isDocumentPaneId(focusedPaneId)) return null;
    const session = sessions.find((candidate) => candidate.id === focusedPaneId);
    if (!session) return null;
    return {
      session,
      label: sessionLabel(
        session,
        sessions.filter((peer) => peer.projectId === session.projectId),
        agents,
      ),
      launchDisabledReason:
        session.projectId === null
          ? "이 세션은 폴더에 속해 있지 않습니다"
          : newSessionDisabledReason(session.projectId),
    };
  }, [activeView, focusedPaneId, sessions, agents, newSessionDisabledReason]);

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
          .filter((worktree) => worktree.projectId === fileExplorerOwnerProject.id && isWorkingWorktree(worktree, workspaceViews))
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
  const {
    openDocument,
    closeDocument,
    closePane,
    openGitDiff,
    openGitGraph,
    openPullRequest,
    refreshReviewWorkspace,
    finishActiveReview,
  } = createDocumentActions({
    setDocuments,
    openPane,
    dropPaneEverywhere,
    openFileTabs,
    requestCloseFileTab,
    fileExplorerTarget,
    fileExplorerTargetLabel,
    fileExplorerOwnerProject,
    setSessions,
    setWorktrees,
    setWorkspaceViews,
    setWorktreeWarnings,
    setActiveReviews,
    selectSession,
    confirm,
    setActionError,
  });

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

  /** 세션 패널의 "여기"가 가리키는 곳. 페이지가 있는 선택만 범위가 된다. */
  const sessionScopeTarget = useMemo<SessionScopeTarget>(() => {
    if (activeView === "home") return { kind: "none" };
    if (activeView === "work-project") {
      return selectedWorkProject
        ? {
            kind: "folders",
            projectIds: selectedWorkProjectMembers.map(({ project }) => project.id),
            label: selectedWorkProject.name,
          }
        : { kind: "none" };
    }
    // 셸프는 어느 폴더의 것도 아니다.
    if (activeView === "terminal" && shelfKind !== null) return { kind: "none" };
    if (selectedWorktree) return { kind: "worktree", worktreeId: selectedWorktree.id, label: selectedWorktree.branch };
    if (selectedProject) return { kind: "folders", projectIds: [selectedProject.id], label: projectName(selectedProject) };
    return { kind: "none" };
  }, [
    activeView,
    shelfKind,
    selectedWorktree,
    selectedProject,
    selectedWorkProject,
    selectedWorkProjectMembers,
  ]);

  /** 세션 패널이 그리는 줄. shelfPaneRows와 같은 이유로 여기서 만든다. */
  const sessionPanelItems = useMemo(
    () => buildSessionPanelItems({ sessions, documentPanes, projects, worktrees, agents, unread }),
    [sessions, documentPanes, projects, worktrees, agents, unread],
  );

  /**
   * What each shelf holds, in slot order — the rows its sidebar entry draws when expanded. A shelf
   * gathers panes from several folders, so every row carries the folder it came from and only this
   * side can say what an id refers to. `onScreen` is true only for the shelf actually being viewed:
   * a pane is on screen once, wherever else it may also be filed.
   */
  const shelfPaneRows = useMemo<Record<ShelfKind, PaneRow[]>>(() => {
    const nameById = new Map(projects.map((project) => [project.id, projectName(project)]));
    const rowsOf = (kind: ShelfKind): PaneRow[] =>
      shelves[kind].slots
        .filter((id): id is string => id !== null)
        .map<PaneRow | null>((id) => {
          const onScreen = shelfKind === kind && onScreenPaneIds.has(id);
          const pane = documentPanes.find((candidate) => candidate.id === id);
          if (pane) {
            return {
              id,
              kind: "document",
              label: pane.label,
              detail: pane.detail,
              onScreen,
              document: pane.kind,
              dirty: pane.dirty,
            };
          }
          const session = sessions.find((candidate) => candidate.id === id);
          if (!session) return null;
          return {
            id,
            kind: "session",
            label: sessionLabel(session, sessions.filter((peer) => peer.projectId === session.projectId), agents),
            detail: session.projectId ? (nameById.get(session.projectId) ?? null) : "도구",
            onScreen,
            status: session.status,
            agent: session.kind,
          };
        })
        .filter((row): row is PaneRow => row !== null);
    return { active: rowsOf("active"), hidden: rowsOf("hidden") };
  }, [shelves, shelfKind, onScreenPaneIds, documentPanes, sessions, projects, agents]);

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
  /**
   * Whether the grid is what the workspace is showing. It looks at the whole arrangement, not just
   * this page, so paging past the last filled slot does not drop the user onto the start page. A
   * slot whose session was removed does not count — the id lingers until the view catches up.
   */
  const showsGrid =
    !loading &&
    !loadError &&
    activeView === "terminal" &&
    currentView.slots.some((id) => id !== null && paneContentFor(id) !== null);

  /** Ctrl+N: 현재 페이지의 N번째 슬롯(그리드가 그리는 순서)으로 키보드 포커스를 옮긴다. */
  const focusVisibleSlot = (slotNumber: number) => {
    if (!showsGrid) return;
    const content = gridSlots[slotNumber - 1];
    if (!content || content.kind !== "session") return;
    focusPane(content.session.id);
    terminalCommands.current.get(content.session.id)?.focus();
  };

  const cycleVisibleSession = (step: number) => {
    if (!showsGrid) return;
    const visible = gridSlots.flatMap((slot) => (slot?.kind === "session" ? [slot.session.id] : []));
    if (visible.length === 0) return;
    const index = visible.indexOf(focusedPaneId ?? "");
    const nextIndex = index === -1 ? (step > 0 ? 0 : visible.length - 1) : (index + step + visible.length) % visible.length;
    const next = visible[nextIndex];
    if (next) {
      focusPane(next);
      terminalCommands.current.get(next)?.focus();
    }
  };
  /**
   * The picker rides above every terminal surface, grid or no grid — it deliberately does not follow
   * `showsGrid`. A folder with nothing open yet still carries a `layoutId` of its own, so choosing an
   * arrangement before the first session is a real choice that sticks; hiding the row also made the
   * header change height from one folder to the next.
   */
  const showsLayoutPicker = !loading && !loadError && activeView === "terminal";

  const titleBarMenus = useMemo(
    () =>
      buildTitleBarMenus(
        {
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
        },
        appSettings.keybindings,
      ),
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
      appSettings.keybindings,
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
    if (id.startsWith("workspace.focus-slot-")) {
      focusVisibleSlot(Number(id.slice("workspace.focus-slot-".length)));
      return;
    }
    if (id.startsWith(NEW_SESSION_PREFIX) && selectedProject) {
      void startSession(selectedProject, id.slice(NEW_SESSION_PREFIX.length), selectedWorktree?.id);
      return;
    }
    const terminal = editTargetId ? (terminalCommands.current.get(editTargetId) ?? null) : null;
    switch (id) {
      case "file.add-folder": void addProject(); break;
      case "file.add-work-project": void createWorkProject(); break;
      case "file.save": if (selectedFileTab) void saveFileTab(selectedFileTab.id); break;
      case "file.relink": relinkSelectedProject(); break;
      // Not window.close(): ✕ hides to the tray, 종료 goes through the session-stop confirmation.
      case "file.quit": void window.multiCliWork.window.quit(); break;
      case "edit.copy": terminal?.copySelection(); break;
      case "edit.paste": terminal?.paste(); break;
      case "edit.select-all": terminal?.selectAll(); break;
      case "edit.find": terminal?.find(); break;
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
      case "session.next":
        cycleVisibleSession(1);
        break;
      case "session.prev":
        cycleVisibleSession(-1);
        break;
      case "session.stop": void stopSession(); break;
      case "session.remove":
        if (selectedSession) void removeSessionById(selectedSession);
        break;
      case "tools.claude-update": void startTool("claude-update"); break;
      case "tools.codex-update": void startTool("codex-update"); break;
      case "tools.edit-agents": void editAgents(); break;
      case "help.check-updates":
        void window.multiCliWork.updates.check().catch((error) => setActionError(errorMessage(error)));
        break;
      case "help.release-notes": void window.multiCliWork.updates.openReleases(); break;
      case "help.repository": void window.multiCliWork.updates.openRepository(); break;
      case "settings.open":
        setSettingsOpen(true);
        break;
    }
  };

  handleMenuActionRef.current = handleMenuAction;
  keyActionEnabledRef.current = (id: string): boolean => {
    switch (id) {
      case "file.save":
        // 예전 Ctrl+S 리스너의 가드: 저장 불가한 탭이면 preventDefault 없이 흘려보냈다.
        return Boolean(
          selectedFileTab &&
            ["markdown", "html", "text"].includes(selectedFileTab.category) &&
            !selectedFileTab.truncated &&
            selectedFileTab.encoding === "utf8",
        );
      default:
        return true;
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
        onOpenRemoteSettings={() => {
          setSettingsTab("mobile");
          setSettingsOpen(true);
        }}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
        snapshot={snapshot}
        projects={projects}
        workProjects={workProjects}
        workspaceShells={workspaceShells}
        categories={projectCategories}
        tagsByWorkProject={tagsByWorkProjectId}
        projectMembership={projectMembership}
        expandedWorkProjects={expandedWorkProjects}
        selectedWorkProjectId={activeView === "work-project" ? selectedWorkProjectId : null}
        onToggleWorkProject={toggleWorkProject}
        onSelectWorkProject={selectWorkProject}
        onCreateWorkProject={() => void createWorkProject()}
        onMoveProjectToWorkProject={(projectId, workProjectId) => void moveProjectToWorkProject(projectId, workProjectId)}
        sessions={sessions}
        agents={agents}
        documentPanes={documentPanes}
        onSelectSession={revealSession}
        onSelectDocument={revealDocument}
        onCloseDocument={closePane}
        worktrees={worktrees}
        activeReviews={activeReviews}
        workspaceViews={workspaceViews}
        selectedWorktreeId={activeView === "home" ? null : selectedWorktreeId}
        onSelectWorktree={selectWorktree}
        onWorktreeContextMenu={(worktree, event) => {
          event.preventDefault();
          setWorktreeMenu({ worktree, x: event.clientX, y: event.clientY });
        }}
        expandedProjects={expandedProjects}
        onToggleProject={toggleProject}
        gridProjectId={gridProjectId}
        sessionPanelItems={sessionPanelItems}
        sessionScopeTarget={sessionScopeTarget}
        focusedPaneId={activeView === "terminal" ? focusedPaneId : null}
        onScreenPaneIds={onScreenPaneIds}
        onSessionContextMenu={(session, event) => {
          event.preventDefault();
          setSessionMenu({
            session,
            label: sessionLabel(
              session,
              sessions.filter((candidate) => candidate.projectId === session.projectId),
              agents,
            ),
            surface: "sidebar",
            x: event.clientX,
            y: event.clientY,
          });
        }}
        renamingSessionId={renameTarget?.surface === "sidebar" ? renameTarget.sessionId : null}
        onRenameSession={(sessionId, name) => void renameSession(sessionId, name)}
        onCancelRename={() => setRenameTarget(null)}
        unread={unread}
        selectedProjectId={activeView === "home" ? null : selectedProjectId}
        isHome={activeView === "home"}
        onOpenHome={openHome}
        editingProjectId={editingProjectId}
        loading={loading}
        loadError={loadError}
        onReload={() => void loadWorkspace({ projectId: selectedProjectId, sessionId: selectedSessionId, view: activeView })}
        onAddProject={() => void addProject()}
        onSelectProject={selectProject}
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
        shelfPaneRows={shelfPaneRows}
        selectedShelf={activeView === "terminal" ? shelfKind : null}
        onSelectShelf={selectShelf}
        onDropPaneOnShelf={movePaneToShelf}
        onPlacePaneOnShelf={placePaneOnShelfRow}
        onSelectShelfPane={revealShelfPane}
        onMovePaneToOtherShelf={movePaneToOtherShelf}
        flashProjectId={flashProjectId}
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
          layout={
            showsLayoutPicker
              ? { layoutId: currentView.layoutId, paneCount: gridPaneCount, onSelect: chooseLayout }
              : null
          }
          pages={
            showsLayoutPicker ? { page: resolvedView.page, count: resolvedView.pages, onChange: setPage } : null
          }
          refreshAll={
            showsLayoutPicker
              ? {
                  count: visibleSessionIds.length,
                  busy: visibleSessionIds.some((sessionId) => refreshingSessionIds.has(sessionId)),
                  onRefresh: refreshVisibleSessions,
                }
              : null
          }
          selectedProject={headerProject}
          selectedSession={headerSession}
          selectedSessionLabel={headerSessionLabel}
          focusedSession={headerFocusedSession}
          onRemoveSession={(session) => void removeSessionById(session)}
          projectMissing={selectedProjectMissing}
          agents={agents}
          pendingAction={pendingAction}
          readOnly={Boolean(snapshot && !snapshot.writable)}
          detailActive={activeView === "detail"}
          onOpenDetail={() => setActiveView("detail")}
          onStartSession={(kind) => startSessionFromHeader(kind)}
          onRequestNewSession={(anchor) => setNewSessionSlot({ index: null, ...anchor })}
          onRelinkProject={relinkSelectedProject}
        />

        <div className="workspace-body">
          <div className="workspace-message-area">
            {activeView !== "home" && selectedProjectMissing ? (
              <div className="missing-root-notice" role="status">
                <FolderX size={14} />
                <span>폴더를 찾을 수 없습니다</span>
                <button
                  type="button"
                  onClick={relinkSelectedProject}
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
          ) : showsGrid ? (
            <div className="workspace-panes">
              <WorkspaceGrid
                layout={resolvedView.layout}
                slots={gridSlots}
                allSessions={sessions}
                paneContexts={paneContexts}
                agents={agents}
                terminalSettings={appSettings.terminal}
                focusedPaneId={focusedPaneId}
                renamingSessionId={renameTarget?.surface === "pane" ? renameTarget.sessionId : null}
                refreshRequests={refreshRequests}
                pendingAction={pendingAction}
                isProjectMissing={isProjectMissing}
                onAttached={(attached) => setSessions((current) => mergeAttachedSession(current, attached))}
                onRefreshComplete={finishSessionRefresh}
                onError={(message) => setActionError(message)}
                onRegisterCommands={registerTerminalCommands}
                onTerminalFocused={setLastFocusedTerminalId}
                onFocusPane={focusPane}
                onResumeSession={(session) => void resumeSession(session)}
                remoteSizeOwners={remoteSizeOwners}
                onReclaimSize={(sessionId) =>
                  void window.multiCliWork.terminals.reclaimSize(sessionId).catch((error) => setActionError(errorMessage(error)))
                }
                onStopSession={(session) => void stopSession(session)}
                onClearSlot={clearSlotAt}
                clearAction={
                  shelfKind === null
                    ? null
                    : { label: SHELF_TEXT[shelfKind].move, title: SHELF_TEXT[shelfKind].moveTitle }
                }
                onSplitColumn={splitColumn}
                onMergeColumn={mergeColumn}
                onRemoveSession={(session) => void removeSessionById(session)}
                onRequestNewSession={(index, anchor) => setNewSessionSlot({ index, ...anchor })}
                onDropPane={dropPaneOnSlot}
                onSnapPane={snapPaneToZone}
                onSessionContextMenu={(session, event) => {
                  event.preventDefault();
                  setSessionMenu({
                    session,
                    label: sessionLabel(
                      session,
                      sessions.filter((candidate) => candidate.projectId === session.projectId),
                      agents,
                    ),
                    surface: "pane",
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
                onStartRename={(sessionId) => setRenameTarget({ sessionId, surface: "pane" })}
                onRenameSession={(sessionId, name) => void renameSession(sessionId, name)}
                onCancelRename={() => setRenameTarget(null)}
              />
            </div>
          ) : activeView === "terminal" && shelfKind !== null ? (
            <section className="terminal-empty">
              <SquareTerminal size={22} />
              <h2>{SHELF_TEXT[shelfKind].empty}</h2>
              <p>{SHELF_TEXT[shelfKind].emptyHint}</p>
            </section>
          ) : activeView === "terminal" && selectedProject ? (
            <FolderStartPage
              key={selectedWorktree ? `${selectedProject.id}:${selectedWorktree.id}` : selectedProject.id}
              project={selectedProject}
              worktree={selectedWorktree}
              worktrees={selectedProjectWorktrees}
              agents={agents}
              vscodeAvailable={availability.vscode}
              pendingAction={pendingAction}
              projectMissing={selectedProjectMissing}
              layoutLabel={resolveLayout(currentView.layoutId, 1).label}
              onStartSession={(kind) => void startSession(selectedProject, kind, selectedWorktree?.id)}
              onSelectWorktree={selectWorktree}
              onCreateWorktree={() => setWorktreeCreateProject(selectedProject)}
              onOpenDetail={() => setActiveView("detail")}
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
              onOpenOnGitHub={() =>
                void runProjectAction(() => window.multiCliWork.projects.openOnGitHub(selectedProject.id))
              }
            />
          ) : activeView === "work-project" && selectedWorkProject ? (
            <WorkProjectDetailPage
              key={selectedWorkProject.id}
              workProject={selectedWorkProject}
              members={selectedWorkProjectMembers}
              categories={projectCategories}
              teamsSyncRoot={workProjectRegistry?.teamsSyncRoot ?? null}
              sessions={folderSessions.filter((session) =>
                selectedWorkProjectMembers.some((member) => member.project.id === session.projectId),
              )}
              agents={agents}
              tags={tagsByWorkProjectId[selectedWorkProject.id] ?? []}
              tagSuggestions={tagSuggestions}
              onSelectSession={selectSession}
              onSelectProject={selectProject}
              onRegistryChanged={setWorkProjectRegistry}
              onTagsChanged={setProjectTags}
              onMemberFolderAdded={handleMemberFolderAdded}
              onRemoveWorkProject={() => {
                const target = selectedWorkProject;
                void confirm({
                  title: `"${target.name}" 프로젝트를 삭제할까요?`,
                  message: "폴더와 세션은 남습니다.",
                  confirmLabel: "삭제",
                  danger: true,
                }).then((confirmed) => {
                  if (confirmed) void removeWorkProject(target.id);
                });
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
              worktrees={selectedProjectWorktrees}
              workspaceViews={workspaceViews}
              activeReviews={activeReviews}
              worktreeSessionCounts={worktreeSessionCounts}
              worktreeWarning={worktreeWarnings[selectedProject.id] ?? null}
              projectMissing={selectedProjectMissing}
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
              onSelectWorktree={selectWorktree}
              onCreateWorktree={() => setWorktreeCreateProject(selectedProject)}
              onWorktreeContextMenu={(worktree, event) => {
                event.preventDefault();
                setWorktreeMenu({ worktree, x: event.clientX, y: event.clientY });
              }}
            />
          ) : (
            <HomeDashboard
              projects={projects}
              workProjects={workProjects}
              projectMembership={projectMembership}
              tagsByWorkProject={tagsByWorkProjectId}
              categories={projectCategories}
              sessions={sessions}
              agents={agents}
              activityLog={activityLog}
              pendingAction={pendingAction}
              disabledReasonFor={newSessionDisabledReason}
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
        explorerUnavailableReason={
          fileExplorerTarget?.kind === "project" && selectedProjectMissing
            ? "폴더를 찾을 수 없습니다 — 다시 연결하면 파일을 볼 수 있습니다"
            : null
        }
        selectedRelativePath={
          selectedFileTab &&
          fileExplorerTarget &&
          selectedFileTab.target.kind === fileExplorerTarget.kind &&
          selectedFileTab.target.id === fileExplorerTarget.id
            ? selectedFileTab.relativePath
            : null
        }
        vscodeAvailable={availability.vscode}
        onOpenFile={(entry) => fileExplorerTarget && openFile(fileExplorerTarget, fileExplorerTargetLabel ?? "", entry)}
        onOpenFileExternal={(entry) => fileExplorerTarget && openWithOs(fileExplorerTarget, entry)}
        onEntryDeleted={(relativePath, kind) =>
          fileExplorerTarget && closeFileTabsUnder(fileExplorerTarget, relativePath, kind)
        }
        onEntryRenamed={(relativePath, nextRelativePath, kind) =>
          fileExplorerTarget && moveFileTabs(fileExplorerTarget, relativePath, nextRelativePath, kind)
        }
        worktreeOptions={gitWorktreeOptions}
        onSelectWorktreeOption={selectGitWorktreeOption}
        onOpenDiff={openGitDiff}
        onOpenGraph={openGitGraph}
        projectId={fileExplorerOwnerProject?.id ?? null}
        selectedPullRequest={focusedPullRequest ? { projectId: focusedPullRequest.projectId, remoteName: focusedPullRequest.remoteName, prNumber: focusedPullRequest.number } : null}
        onOpenPullRequest={openPullRequest}
      />

      {newSessionSlot ? (
        <NewSessionLauncher
          x={newSessionSlot.x}
          y={newSessionSlot.y}
          projects={recentProjects(projects, sessions)}
          worktrees={worktrees.filter((worktree) => isWorkingWorktree(worktree, workspaceViews))}
          agents={agents}
          disabledReasonFor={newSessionDisabledReason}
          onStart={(project, agentId, worktreeId) =>
            void startSessionInSlot(project, agentId, worktreeId, newSessionSlot.index)
          }
          onClose={() => setNewSessionSlot(null)}
        />
      ) : null}

      {contextMenu ? (
        <ProjectContextMenu
          projectName={projectName(contextMenu.project)}
          x={contextMenu.x}
          y={contextMenu.y}
          vscodeAvailable={availability.vscode}
          agents={agents}
          newSessionDisabledReason={newSessionDisabledReason(contextMenu.project.id)}
          onStartSession={(agentId) => void startSessionInBackground(contextMenu.project, agentId)}
          onReveal={() => void runProjectAction(() => window.multiCliWork.projects.reveal(contextMenu.project.id))}
          onOpenInEditor={() =>
            void runProjectAction(() => window.multiCliWork.projects.openInEditor(contextMenu.project.id))
          }
          onOpenOnGitHub={() =>
            void runProjectAction(() => window.multiCliWork.projects.openOnGitHub(contextMenu.project.id))
          }
          onCreateWorktree={() => setWorktreeCreateProject(contextMenu.project)}
          onRename={() => {
            // 편집칸이 폴더 아래에 붙으므로, 접혀 있었다면 먼저 펴야 보인다.
            expandProject(contextMenu.project.id);
            setEditingProjectId(contextMenu.project.id);
          }}
          onRelink={() => void relinkProject(contextMenu.project)}
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
          agents={agents}
          newSessionDisabledReason={
            // A worktree without its folder in the list has no project to start from — the same
            // dead end a missing root is, so it reads the same way.
            worktreeMenuProject
              ? newSessionDisabledReason(worktreeMenuProject.id)
              : "폴더를 찾을 수 없습니다"
          }
          onStartSession={(agentId) => {
            if (worktreeMenuProject) {
              void startSessionInBackground(worktreeMenuProject, agentId, worktreeMenu.worktree.id);
            }
          }}
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
          hidden={shelves.hidden.slots.includes(sessionMenu.session.id)}
          onToggleHidden={() =>
            movePaneToShelf(
              shelves.hidden.slots.includes(sessionMenu.session.id) ? "active" : "hidden",
              sessionMenu.session.id,
            )
          }
          onRefresh={() => void refreshSession(sessionMenu.session.id)}
          onRename={() => setRenameTarget({ sessionId: sessionMenu.session.id, surface: sessionMenu.surface })}
          onResetName={() => void renameSession(sessionMenu.session.id, null)}
          onExportLog={() => {
            const target = sessionMenu;
            void window.multiCliWork.terminals
              .exportLog(target.session.id, target.label)
              .catch((error) => setActionError(errorMessage(error)));
          }}
          onRemove={() => void removeSessionById(sessionMenu.session)}
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

      {settingsOpen ? (
        <SettingsDialog
          settings={appSettings}
          initialTab={settingsTab}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsTab(undefined);
          }}
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
        <WorktreeRemovalDialog
          removal={worktreeRemoval}
          busy={pendingAction}
          onCancel={() => setWorktreeRemoval(null)}
          onConfirm={() => void confirmWorktreeRemoval(worktreeRemoval.worktree)}
        />
      ) : null}

      {worktreeForce ? (
        <WorktreeForceDialog
          force={worktreeForce}
          busy={pendingAction}
          onCancel={() => setWorktreeForce(null)}
          onConfirm={() => void forceWorktreeRemoval(worktreeForce.worktree)}
        />
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
          templates={appSettings.fanOut.templates}
          onSaveTemplates={(templates) =>
            void window.multiCliWork.settings
              .update({ fanOut: { templates } })
              .then(setAppSettings)
              .catch((error) => setActionError(errorMessage(error)))
          }
          onSend={(inputs) => void sendFanOut(inputs)}
          onClose={() => setFanOutVisible(false)}
        />
      ) : null}

      {diffView ? <DiffView title={diffView.title} result={diffView.result} onClose={() => setDiffView(null)} /> : null}

      {fileTabCloseRequest ? (
        <UnsavedFileDialog
          tab={fileTabCloseRequest}
          onCancel={() => setFileTabCloseRequest(null)}
          onSaveAndClose={async () => {
            const tab = fileTabCloseRequest;
            setFileTabCloseRequest(null);
            if (await saveFileTab(tab.id)) closeFileTabImmediately(tab.id);
          }}
          onDiscard={() => {
            const tab = fileTabCloseRequest;
            setFileTabCloseRequest(null);
            closeFileTabImmediately(tab.id);
          }}
        />
      ) : null}

      {runConfirmRequest ? (
        <RunConfirmDialog
          request={runConfirmRequest}
          onCancel={() => setRunConfirmRequest(null)}
          onRun={() => {
            const request = runConfirmRequest;
            setRunConfirmRequest({ ...request, running: true, error: null });
            void window.multiCliWork.workspaceFiles.openEntry(request.target, request.entry.relativePath, { confirmedRun: true })
              .then(() => setRunConfirmRequest(null))
              .catch((error) => setRunConfirmRequest((current) => current ? { ...current, running: false, error: errorMessage(error) } : null));
          }}
        />
      ) : null}

      {confirmDialog}

      {removal ? (
        <FolderRemovalDialog
          removal={removal}
          name={projectName(removal.project)}
          busy={pendingAction}
          onCancel={() => setRemoval(null)}
          onConfirm={() => void confirmRemoval(removal.project)}
        />
      ) : null}
    </div>
    </div>
  );
}
