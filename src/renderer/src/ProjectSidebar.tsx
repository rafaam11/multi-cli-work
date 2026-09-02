import type { AgentView } from "@shared/agent-types";
import type { ProjectWorkspaceSnapshot, SessionAttention, TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { WorkProject, WorkProjectRole } from "@shared/work-project-types";
import type { WorkspaceShellInfo } from "@shared/workspace-types";
import {
  Briefcase,
  Boxes,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderX,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  SquareTerminal,
  TriangleAlert,
  Zap,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { reorderIds, type DropPosition } from "./project-order";
import { ProjectMetadataEditor } from "./ProjectMetadataEditor";
import { SessionPanel } from "./SessionPanel";
import { UpdateBadge } from "./UpdateBadge";
import { AgentIcon, GitHubIcon, TeamsIcon } from "./brand-icons";
import { DocumentPaneIcon, paneRowClass, type DocumentPane, type PaneRow } from "./pane-items";
import { findAgent, projectName } from "./session-labels";
import { isSessionDrag, readSessionDrag, startSessionDrag } from "./session-drag";
import type { SessionPanelItem, SessionScope, SessionScopeTarget } from "./session-panel";
import {
  buildTreeNodes,
  buildTreeSections,
  channelKeys,
  collapsedChannelKeysForWorking,
  type ChannelNode,
  type TreeSection,
} from "./sidebar-tree";
import { categoryAccentClass, channelAccentClass, isWorkProjectDormant } from "./work-project-accent";
import { folderActivityClass, isFolderActive } from "./folder-status";
import { SHELF_KINDS, SHELF_TEXT, type ShelfKind } from "./shelves";

interface ProjectSidebarProps {
  snapshot: ProjectWorkspaceSnapshot | null;
  projects: SharedProject[];
  /** Work projects in display order; folders whose id is absent from every membership are 미분류. */
  workProjects: WorkProject[];
  /**
   * ws-root 워크스페이스의 셸에서 만들어진 업무 프로젝트만, id → 그 셸. 여기 있는 항목은 채널
   * 아래로 한 겹 더 들어가고 셸의 한글 `title:`로 불린다. 비어 있으면(루트 미등록) 트리는
   * 이 기능이 없던 때와 똑같이 그려진다.
   */
  workspaceShells: Record<string, WorkspaceShellInfo>;
  projectMembership: Record<string, { workProjectId: string; role: WorkProjectRole }>;
  expandedWorkProjects: Set<string>;
  selectedWorkProjectId: string | null;
  onToggleWorkProject(workProjectId: string): void;
  onSelectWorkProject(workProjectId: string): void;
  onCreateWorkProject(): void;
  /** Null moves the folder back to 미분류. Also the drop action for cross-group drags. */
  onMoveProjectToWorkProject(projectId: string, workProjectId: string | null): void;
  /**
   * Every session, tool sessions included: 폴더 활동색·세션 수·레일·푸터·작업중 계산에 쓴다. 행은
   * 세션 패널이 그린다.
   */
  sessions: TerminalSessionView[];
  agents: AgentView[];
  /** 세션 패널이 그리는 줄. App이 정렬까지 끝내 넘긴다 — 어느 id가 무엇인지는 App만 안다. */
  sessionPanelItems: readonly SessionPanelItem[];
  /** "여기" 토글이 가리키는 곳. 페이지가 없는 선택이면 none이고 토글은 비활성이다. */
  sessionScopeTarget: SessionScopeTarget;
  /** The pane with the focus, wherever it sits — the row drawn as current. */
  focusedPaneId: string | null;
  /** Panes the grid is drawing right now; the rest are one click from coming back. */
  onScreenPaneIds: Set<string>;
  onSelectSession(session: TerminalSessionView): void;
  onSelectDocument(pane: DocumentPane): void;
  onCloseDocument(pane: DocumentPane): void;
  onSessionContextMenu(session: TerminalSessionView, event: ReactMouseEvent): void;
  /** Set only while the rename started here — the pane header runs its own input off the same state. */
  renamingSessionId: string | null;
  onRenameSession(sessionId: string, name: string | null): void;
  onCancelRename(): void;
  /** Sessions that started waiting while off screen — the sidebar's dot badges. */
  unread: Record<string, SessionAttention>;
  selectedProjectId: string | null;
  editingProjectId: string | null;
  loading: boolean;
  loadError: string | null;
  onReload(): void;
  onAddProject(): void;
  /** A folder is a leaf: its row only ever opens the grid, so there is nothing to fold. */
  onSelectProject(projectId: string): void;
  /** The 프로젝트 half of 모두/접기; the 채널 half is the sidebar's own and rides along. */
  onExpandAll(): void;
  onCollapseAll(): void;
  /**
   * One-shot tidy: leaves the 프로젝트 owning a 작업중 folder open and closes the rest. Not a mode
   * that stays on. The channels holding those projects are opened here in the sidebar.
   */
  onExpandWorking(): void;
  onReorderProjects(orderedIds: string[]): void;
  onProjectContextMenu(project: SharedProject, event: ReactMouseEvent): void;
  onProjectSaved(project: SharedProject): void;
  onCloseEditor(): void;
  onRestoreBackup(): void;
  /**
   * What each shelf holds, in slot order. A shelf gathers panes from several folders, so only App
   * can say what an id refers to — the sidebar draws the rows it is handed. The views themselves
   * stay in App, which is the single writer for slots.
   */
  shelfPaneRows: Record<ShelfKind, PaneRow[]>;
  selectedShelf: ShelfKind | null;
  onSelectShelf(kind: ShelfKind): void;
  /** A row dropped on a shelf row. It leaves the other shelf — a pane belongs to exactly one. */
  onDropPaneOnShelf(kind: ShelfKind, paneId: string): void;
  /** A pane dropped beside another shelf pane, with the row half choosing before or after. */
  onPlacePaneOnShelf(kind: ShelfKind, paneId: string, targetPaneId: string, position: DropPosition): void;
  /** A pane picked from an expanded shelf row: show that shelf, on the page holding the pane. */
  onSelectShelfPane(kind: ShelfKind, paneId: string): void;
  /** Hands the pane to the other shelf. The session keeps running and the document stays open. */
  onMovePaneToOtherShelf(kind: ShelfKind, paneId: string): void;
  /** The folder a jump just pointed at. It pulses for a moment, then App clears this. */
  flashProjectId: string | null;
  isHome: boolean;
  onOpenHome(): void;
  collapsed: boolean;
  onToggleCollapse(): void;
}

/**
 * Which tree nodes are folded away, and which shelf rows are unfolded. The two are stored in one
 * record because they are one thing to the user — how much of the sidebar is showing.
 *
 * The polarities differ on purpose: a channel in `expandedWorkspaces` is *collapsed* (so a channel
 * that appears later starts open, showing what it gathers), while a shelf in `openShelves` is
 * *expanded* (so the shelf stays a one-line summary until asked otherwise).
 *
 * `expandedWorkspaces` also holds `worktree:*`/`main:*` keys written before the tree's worktree
 * layer was removed. Nothing reads them any more; they cost one string each and are left alone.
 */
const SIDEBAR_STATE_KEY = "multi-cli-work.sidebar.v1";

/**
 * Up to v1.19 `openShelves` held the indexes of 작업공간1/2/3. Those numbers name nothing now, so a
 * file written back then simply arrives with no shelves open — the same state a new install has.
 */
function readSidebarState(): {
  expandedWorkspaces: string[];
  openShelves: ShelfKind[];
  sessionPanelOpen: boolean;
  sessionScope: SessionScope;
} {
  try {
    const value = JSON.parse(localStorage.getItem(SIDEBAR_STATE_KEY) ?? "{}") as {
      expandedWorkspaces?: string[];
      openShelves?: unknown[];
      sessionPanelOpen?: unknown;
      sessionScope?: unknown;
    };
    return {
      expandedWorkspaces: value.expandedWorkspaces ?? [],
      openShelves: (value.openShelves ?? []).filter((kind): kind is ShelfKind =>
        SHELF_KINDS.includes(kind as ShelfKind),
      ),
      // 세션 패널은 열려 있는 것이 기본이다 — 이 키를 모르는 파일에서도 패널이 보여야 한다.
      sessionPanelOpen: value.sessionPanelOpen !== false,
      sessionScope: value.sessionScope === "here" ? "here" : "all",
    };
  } catch {
    return { expandedWorkspaces: [], openShelves: [], sessionPanelOpen: true, sessionScope: "all" };
  }
}

/**
 * With no session rows left in the tree, a folder's own badge is the only unread signal the
 * sidebar has — so it rolls up its sessions and keeps the loudest of them, 승인 대기 first.
 */
function rollUpAttention(
  sessions: TerminalSessionView[],
  unread: Record<string, SessionAttention>,
): SessionAttention | null {
  return sessions.reduce<SessionAttention | null>((strongest, session) => {
    const attention = unread[session.id];
    if (attention === "approval" || strongest === "approval") return "approval";
    return attention ?? strongest;
  }, null);
}

function attentionLabel(attention: SessionAttention): string {
  return attention === "approval" ? "승인 대기 세션 있음" : "입력 대기 세션 있음";
}

export function ProjectSidebar({
  snapshot,
  projects,
  workProjects,
  workspaceShells,
  projectMembership,
  expandedWorkProjects,
  selectedWorkProjectId,
  onToggleWorkProject,
  onSelectWorkProject,
  onCreateWorkProject,
  onMoveProjectToWorkProject,
  sessions,
  agents,
  sessionPanelItems,
  sessionScopeTarget,
  focusedPaneId,
  onScreenPaneIds,
  onSelectSession,
  onSelectDocument,
  onCloseDocument,
  onSessionContextMenu,
  renamingSessionId,
  onRenameSession,
  onCancelRename,
  unread,
  selectedProjectId,
  editingProjectId,
  loading,
  loadError,
  onReload,
  onAddProject,
  onSelectProject,
  onExpandAll,
  onCollapseAll,
  onExpandWorking,
  onReorderProjects,
  onProjectContextMenu,
  onProjectSaved,
  onCloseEditor,
  onRestoreBackup,
  shelfPaneRows,
  selectedShelf,
  onSelectShelf,
  onDropPaneOnShelf,
  onPlacePaneOnShelf,
  onSelectShelfPane,
  onMovePaneToOtherShelf,
  flashProjectId,
  isHome,
  onOpenHome,
  collapsed,
  onToggleCollapse,
}: ProjectSidebarProps) {
  const readOnly = Boolean(snapshot && !snapshot.writable);
  const [drag, setDrag] = useState<{ id: string; over: { id: string; position: DropPosition } | null } | null>(null);
  const [shelfDropKind, setShelfDropKind] = useState<ShelfKind | null>(null);
  const [shelfPaneDrop, setShelfPaneDrop] = useState<{
    kind: ShelfKind;
    paneId: string;
    position: DropPosition;
  } | null>(null);
  const flashRow = useRef<HTMLDivElement | null>(null);
  // 네 값이 한 레코드에서 오므로 마운트 때 한 번만 읽는다.
  const [savedSidebarState] = useState(readSidebarState);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(
    () => new Set(savedSidebarState.expandedWorkspaces),
  );
  const [openShelves, setOpenShelves] = useState<Set<ShelfKind>>(() => new Set(savedSidebarState.openShelves));
  const [sessionPanelOpen, setSessionPanelOpen] = useState(savedSidebarState.sessionPanelOpen);
  const [sessionScope, setSessionScope] = useState<SessionScope>(savedSidebarState.sessionScope);
  // Every toggle writes the whole record, so none can drop another's share of it.
  const persist = (
    workspaces: Set<string>,
    shelves: Set<ShelfKind>,
    panelOpen: boolean,
    scope: SessionScope,
  ) => {
    try {
      localStorage.setItem(
        SIDEBAR_STATE_KEY,
        JSON.stringify({
          version: 1,
          expandedWorkspaces: [...workspaces],
          openShelves: [...shelves],
          sessionPanelOpen: panelOpen,
          sessionScope: scope,
        }),
      );
    } catch { /* unavailable storage */ }
  };
  const toggleWorkspace = (key: string) => setExpandedWorkspaces((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    persist(next, openShelves, sessionPanelOpen, sessionScope);
    return next;
  });
  const toggleShelf = (kind: ShelfKind) => setOpenShelves((current) => {
    const next = new Set(current);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    persist(expandedWorkspaces, next, sessionPanelOpen, sessionScope);
    return next;
  });

  // A folder pointed at from a tab may sit inside a collapsed group; App expands it, and the row
  // scrolls itself into view here rather than leaving the pulse to happen off screen.
  useEffect(() => {
    if (!flashProjectId) return;
    flashRow.current?.scrollIntoView?.({ block: "nearest" });
  }, [flashProjectId]);

  const endDrag = () => setDrag(null);

  /**
   * Shelf rows accept panes, not folders — folder drags carry only `text/plain`, so the session type
   * is what tells the two apart. The drop moves the pane: it leaves whichever shelf it was on, and
   * keeps its folder tab either way.
   */
  const shelfDropProps = (kind: ShelfKind) => ({
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      if (!isSessionDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setShelfDropKind(kind);
    },
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setShelfDropKind((current) => (current === kind ? null : current));
    },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      if (!isSessionDrag(event)) return;
      event.preventDefault();
      setShelfDropKind(null);
      const paneId = readSessionDrag(event);
      if (paneId) onDropPaneOnShelf(kind, paneId);
    },
  });

  /** Expanded shelf rows split into before/after targets, matching folder insertion feedback. */
  const shelfPaneDropProps = (kind: ShelfKind, targetPaneId: string) => ({
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      if (!isSessionDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const bounds = event.currentTarget.getBoundingClientRect();
      const position: DropPosition = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
      setShelfPaneDrop((current) =>
        current?.kind === kind && current.paneId === targetPaneId && current.position === position
          ? current
          : { kind, paneId: targetPaneId, position },
      );
    },
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setShelfPaneDrop((current) =>
        current?.kind === kind && current.paneId === targetPaneId ? null : current,
      );
    },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      if (!isSessionDrag(event)) return;
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      const position: DropPosition = event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
      setShelfPaneDrop(null);
      const paneId = readSessionDrag(event);
      if (paneId) onPlacePaneOnShelf(kind, paneId, targetPaneId, position);
    },
  });

  const shelfLabel = (kind: ShelfKind, count: number) =>
    `${SHELF_TEXT[kind].name} 열기 (패인 ${count}개)`;

  /** 작업공간 gets the grid mark, 숨김 the crossed eye — the same pairing as the ✕ on its rows. */
  const ShelfIcon = ({ kind, size }: { kind: ShelfKind; size: number }) =>
    kind === "hidden" ? <EyeOff size={size} /> : <LayoutGrid size={size} />;

  const dropOn = (targetId: string, position: DropPosition) => {
    if (!drag) return;
    const dragId = drag.id;
    endDrag();
    // Dropping on a folder of another group moves the membership; reordering stays within a group.
    const groupOf = (id: string) => projectMembership[id]?.workProjectId ?? null;
    if (groupOf(dragId) !== groupOf(targetId)) {
      onMoveProjectToWorkProject(dragId, groupOf(targetId));
      return;
    }
    const ordered = reorderIds(
      projects.map((project) => project.id),
      dragId,
      targetId,
      position,
    );
    // A drag that put the folder back where it started is not worth a registry write.
    if (ordered.some((id, index) => id !== projects[index]?.id)) onReorderProjects(ordered);
  };

  // 트리의 모양은 순수 함수가 만든다 — 그리는 쪽은 그 결과를 받아 쓰기만 한다.
  const treeSections = useMemo(
    () => buildTreeSections(workProjects, projects, projectMembership),
    [workProjects, projects, projectMembership],
  );
  const treeNodes = useMemo(() => buildTreeNodes(treeSections, workspaceShells), [treeSections, workspaceShells]);

  /**
   * 트리 컨트롤이 닿는 층은 채널과 프로젝트 둘뿐이다(폴더는 잎이다). 프로젝트 접힘은 App이,
   * 채널 접힘은 여기가 갖고 있으므로 App 콜백을 부른 뒤 채널 키를 함께 갱신한다. 채널이 아닌
   * 키(`worktree:*`·`main:*`)는 아무도 읽지 않으므로 손대지 않고 남겨 둔다.
   */
  const persistWorkspaces = (next: Set<string>) => {
    setExpandedWorkspaces(next);
    persist(next, openShelves, sessionPanelOpen, sessionScope);
  };
  const keepNonChannelKeys = () => [...expandedWorkspaces].filter((key) => !key.startsWith("channel:"));
  const runExpandAll = () => {
    onExpandAll();
    persistWorkspaces(new Set(keepNonChannelKeys()));
  };
  const runCollapseAll = () => {
    onCollapseAll();
    persistWorkspaces(new Set([...expandedWorkspaces, ...channelKeys(treeNodes)]));
  };
  const runExpandWorking = () => {
    onExpandWorking();
    const working = new Set(
      projects
        .filter((project) => isFolderActive(sessions.filter((session) => session.projectId === project.id)))
        .map((project) => project.id),
    );
    persistWorkspaces(
      new Set([...keepNonChannelKeys(), ...collapsedChannelKeysForWorking(treeNodes, working)]),
    );
  };

  const attentionOf = (candidates: TerminalSessionView[]) => rollUpAttention(candidates, unread);

  /**
   * Every row standing for a pane can be dragged onto a 작업공간 row or onto a slot in the grid. The
   * payload is the pane id — a session id or a document id — which is all any drop target needs.
   * Folder rows drag too, for reordering, so the event is stopped rather than left to bubble.
   */
  const paneDragProps = (paneId: string) => ({
    draggable: true,
    onDragStart: (event: ReactDragEvent<HTMLElement>) => {
      event.stopPropagation();
      startSessionDrag(event, paneId);
    },
    onDragEnd: () => {
      setShelfDropKind(null);
      setShelfPaneDrop(null);
    },
  });

  const rowClass = (paneId: string, ...extra: string[]) =>
    paneRowClass(paneId, focusedPaneId, onScreenPaneIds, ...extra);

  /**
   * A pane inside an expanded shelf row. It is the same row as in the tree, but it answers to the
   * shelf: clicking goes to the page of *that* shelf holding it, and ✕ hands it to the other shelf
   * rather than closing anything — 작업공간 puts it away, 숨김 brings it back.
   */
  const renderShelfPane = (kind: ShelfKind, row: PaneRow) => (
    <li key={row.id}>
      <div
        className={rowClass(
          row.id,
          "file-tab-row",
          row.kind === "session" ? `status-${row.status}` : "",
          shelfPaneDrop?.kind === kind && shelfPaneDrop.paneId === row.id
            ? `pane-drop-${shelfPaneDrop.position}`
            : "",
        )}
        {...paneDragProps(row.id)}
        {...shelfPaneDropProps(kind, row.id)}
      >
        <button
          type="button"
          className="file-tab-open"
          onClick={() => onSelectShelfPane(kind, row.id)}
          aria-label={`${row.label} 패인 열기`}
          title={row.detail ? `${row.label} · ${row.detail}` : row.label}
        >
          {row.kind === "session" ? (
            <span className={`status-dot status-${row.status}`} aria-hidden="true" />
          ) : (
            <span className={`file-tab-dot ${row.dirty ? "dirty" : ""}`} aria-hidden="true" />
          )}
          {row.kind === "session" ? (
            <AgentIcon agent={findAgent(agents, row.agent)} size={13} />
          ) : (
            <DocumentPaneIcon kind={row.document} size={13} />
          )}
          <span className="session-name">{row.label}</span>
          {row.detail ? <span className="session-detail">{row.detail}</span> : null}
        </button>
        <button
          type="button"
          className="file-tab-close"
          onClick={() => onMovePaneToOtherShelf(kind, row.id)}
          aria-label={`${row.label} ${SHELF_TEXT[kind].move}`}
          title={SHELF_TEXT[kind].moveTitle}
        >
          {kind === "hidden" ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      </div>
    </li>
  );

  /**
   * The collapsed rail switches between folders, not sessions: with the grid showing a folder's
   * terminals at once, the folder is the unit worth one click of a 44px-wide strip.
   */
  const renderRailProject = (project: SharedProject) => {
    const name = projectName(project);
    const projectSessions = sessions.filter((session) => session.projectId === project.id);
    const active = isFolderActive(projectSessions);
    const attention = attentionOf(projectSessions);
    const rootMissing = snapshot?.missingRootProjectIds.includes(project.id) ?? false;
    const details = [
      active ? "작업 중" : null,
      attention ? attentionLabel(attention) : null,
      rootMissing ? "폴더 없음" : null,
    ].filter(Boolean);
    return (
      <li key={project.id}>
        <button
          type="button"
          className={[
            "rail-session-button",
            folderActivityClass(projectSessions),
            selectedProjectId === project.id ? "selected" : "",
            rootMissing ? "missing" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onSelectProject(project.id)}
          onContextMenu={(event) => onProjectContextMenu(project, event)}
          title={name}
          aria-label={`${name} 폴더 선택${details.map((detail) => ` (${detail})`).join("")}`}
        >
          {rootMissing ? <FolderX size={15} aria-hidden="true" /> : <Folder size={15} />}
          {active ? <span className="folder-activity-dot" aria-hidden="true" /> : null}
          {attention ? <span className={`unread-dot unread-${attention}`} aria-hidden="true" /> : null}
        </button>
      </li>
    );
  };

  /**
   * 워크스페이스에서 온 업무 프로젝트는 셸의 한글 `title:`로 부른다 — 폴더명(`24_SMCH_VSP-1`)은
   * 규약을 위한 이름이지 사람이 읽을 이름이 아니다(루트 CLAUDE.md §2).
   */
  const workProjectLabel = (workProject: WorkProject) =>
    workspaceShells[workProject.id]?.title ?? workProject.name;

  /**
   * 채널 줄. 업무 프로젝트 줄과 달리 열 화면이 없으므로 접고 펴는 것이 전부다 — 채널은 폴더도
   * 세션도 직접 갖지 않는, 셸을 모아 두는 이름일 뿐이기 때문.
   */
  const renderChannel = (node: ChannelNode) => {
    // 키가 있으면 접힌 것이다 — 그래야 새로 생긴 채널이 펼쳐진 채로 시작한다.
    const collapsedChannel = expandedWorkspaces.has(node.key);
    return (
      <li
        className={`channel-node ${channelAccentClass(node.letter)}`}
        key={node.key}
        role="treeitem"
        aria-expanded={!collapsedChannel}
      >
        <div className="channel-row">
          <button
            className="tree-toggle"
            type="button"
            onClick={() => toggleWorkspace(node.key)}
            aria-label={`${node.channel} ${collapsedChannel ? "펼치기" : "접기"}`}
            title={`${node.channel} ${collapsedChannel ? "펼치기" : "접기"}`}
          >
            {collapsedChannel ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
          <span className="channel-copy">
            <Boxes size={13} aria-hidden="true" />
            <span className="channel-name">{node.channel}</span>
            <span className="channel-label">{node.label}</span>
          </span>
        </div>
        {collapsedChannel ? null : (
          <ul className="channel-group" role="group" aria-label={node.channel}>
            {node.sections.map(renderSection)}
          </ul>
        )}
      </li>
    );
  };

  /**
   * 트리의 한 묶음 — 업무 프로젝트 하나(또는 미분류)와 그 아래 폴더들. 채널 밑에 들어가든
   * 최상위에 서든 같은 줄이라, 그리는 코드는 하나다.
   */
  const renderSection = (section: TreeSection) => {
              const workProject = section.workProject;
              const sectionExpanded = workProject ? expandedWorkProjects.has(workProject.id) : true;
              // Its page is already on screen, so the row has nothing left to open — it folds instead.
              const sectionShowing = workProject !== null && selectedWorkProjectId === workProject.id;
              // With no work projects at all the single unassigned section has no header either,
              // so it takes no rail — the tree stays exactly as it was before grouping existed.
              const railed = workProject !== null || workProjects.length > 0;
              return (
                <li
                  className={[
                    "work-project-node",
                    workProject ? categoryAccentClass(workProject.category) : "unassigned-node",
                    railed ? "categorized" : "",
                    workProject && isWorkProjectDormant(workProject.status) ? "dormant" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={section.key}
                  role="treeitem"
                  aria-expanded={sectionExpanded}
                >
                  {workProject ? (
                    <div
                      className={`work-project-row ${selectedWorkProjectId === workProject.id ? "selected" : ""}`}
                      onDragOver={(event) => {
                        // A folder dragged onto the group header moves into that group.
                        if (!drag || projectMembership[drag.id]?.workProjectId === workProject.id) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        if (!drag) return;
                        event.preventDefault();
                        const dragId = drag.id;
                        endDrag();
                        onMoveProjectToWorkProject(dragId, workProject.id);
                      }}
                    >
                      <button
                        className="tree-toggle"
                        type="button"
                        onClick={() => onToggleWorkProject(workProject.id)}
                        aria-label={`${workProjectLabel(workProject)} ${sectionExpanded ? "접기" : "펼치기"}`}
                        title={`${workProjectLabel(workProject)} ${sectionExpanded ? "접기" : "펼치기"}`}
                      >
                        {sectionExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <button
                        className="work-project-select"
                        type="button"
                        onClick={() =>
                          sectionShowing
                            ? onToggleWorkProject(workProject.id)
                            : onSelectWorkProject(workProject.id)
                        }
                        aria-label={`${workProjectLabel(workProject)} 프로젝트 열기`}
                      >
                        <Briefcase size={15} />
                        {/* Name only — the 구분 reads from the icon and rail colour, and the folder
                            count is one expand away. The chip and counts moved out for quiet. */}
                        <span className="project-copy">
                          <span className="project-name" title={workProject.name}>
                            {workProjectLabel(workProject)}
                          </span>
                        </span>
                      </button>
                    </div>
                  ) : workProjects.length > 0 ? (
                    <div
                      className="work-project-row unassigned-row"
                      onDragOver={(event) => {
                        if (!drag || !projectMembership[drag.id]) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        if (!drag) return;
                        event.preventDefault();
                        const dragId = drag.id;
                        endDrag();
                        onMoveProjectToWorkProject(dragId, null);
                      }}
                    >
                      <span className="unassigned-label">미분류</span>
                    </div>
                  ) : null}
                  {sectionExpanded ? (
                    section.projects.length === 0 && workProject ? (
                      <ul className="project-group" role="group" aria-label={workProjectLabel(workProject)}>
                        <li className="work-project-empty">폴더 없음 — 상세 페이지에서 추가</li>
                      </ul>
                    ) : (
            <ul className="project-group" role="group" aria-label={workProject ? workProjectLabel(workProject) : "미분류"}>
            {section.projects.map((project) => {
              const name = projectName(project);
              const rootMissing = snapshot?.missingRootProjectIds.includes(project.id) ?? false;
              const projectSessions = sessions.filter((session) => session.projectId === project.id);
              // The folder row shows the strongest wait among its sessions — the tree has no
              // session rows of its own to say it instead.
              const projectAttention = attentionOf(projectSessions);
              // 잎이라 `aria-expanded`가 없다 — 열고 닫을 하위 층이 없다는 뜻이다.
              return (
                <li className="project-node" key={project.id} role="treeitem">
                  <div
                    ref={flashProjectId === project.id ? flashRow : undefined}
                    className={[
                      "project-row",
                      folderActivityClass(projectSessions),
                      selectedProjectId === project.id ? "selected" : "",
                      flashProjectId === project.id ? "flash" : "",
                      rootMissing ? "missing" : "",
                      drag?.id === project.id ? "dragging" : "",
                      drag?.over?.id === project.id ? `drop-${drag.over.position}` : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onContextMenu={(event) => onProjectContextMenu(project, event)}
                    draggable={!readOnly}
                    onDragStart={(event) => {
                      // A payload is required for the drag to start at all; the id we act on is
                      // tracked in state, because dragover cannot read dataTransfer.
                      event.dataTransfer.setData("text/plain", project.id);
                      event.dataTransfer.effectAllowed = "move";
                      setDrag({ id: project.id, over: null });
                    }}
                    onDragOver={(event) => {
                      if (!drag || drag.id === project.id) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      const bounds = event.currentTarget.getBoundingClientRect();
                      const position: DropPosition =
                        event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
                      setDrag((current) =>
                        !current || (current.over?.id === project.id && current.over.position === position)
                          ? current
                          : { ...current, over: { id: project.id, position } },
                      );
                    }}
                    onDrop={(event) => {
                      if (!drag || drag.id === project.id) return;
                      event.preventDefault();
                      const bounds = event.currentTarget.getBoundingClientRect();
                      dropOn(project.id, event.clientY < bounds.top + bounds.height / 2 ? "before" : "after");
                    }}
                    onDragEnd={endDrag}
                  >
                    <button
                      className="project-select"
                      type="button"
                      onClick={() => onSelectProject(project.id)}
                      aria-label={`${name} 폴더 선택`}
                      title={project.rootPath}
                    >
                      {rootMissing ? (
                        <FolderX size={15} aria-label="폴더 없음" />
                      ) : projectMembership[project.id]?.role === "docs" ? (
                        <TeamsIcon size={15} className="brand-icon-teams" />
                      ) : projectMembership[project.id]?.role === "repo" ? (
                        <GitHubIcon size={15} className="brand-icon-github" />
                      ) : selectedProjectId === project.id ? (
                        <FolderOpen size={15} />
                      ) : (
                        <Folder size={15} />
                      )}
                      <span className="project-copy">
                        <span className="project-name">{name}</span>
                      </span>
                      {/* The row's right edge is a rail: the count lands on the same spot for every
                          folder instead of trailing a name of whatever length, and the rarer
                          signals queue up to its left. */}
                      <span className="project-signals">
                        {projectAttention ? (
                          <span
                            className={`unread-dot unread-${projectAttention}`}
                            role="status"
                            aria-label={attentionLabel(projectAttention)}
                            title={attentionLabel(projectAttention)}
                          />
                        ) : null}
                        {rootMissing ? <span className="project-status missing-status">없음</span> : null}
                        {/* Its worktrees' sessions count too: the folder answers "how much is
                            running here", and the 폴더 상세 워크트리 카드 breaks that down. */}
                        {projectSessions.length > 0 ? (
                          <span className="folder-session-count" title={`세션 ${projectSessions.length}개`}>
                            {projectSessions.length}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </div>
                  {editingProjectId === project.id ? (
                    <ProjectMetadataEditor project={project} onSaved={onProjectSaved} onClose={onCloseEditor} />
                  ) : null}
                </li>
              );
            })}
            </ul>
                    )
                  ) : null}
                </li>
              );
  };

  return (
    <aside className={`project-sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-top-row">
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
        <button
          type="button"
          className="icon-button sidebar-collapse-toggle"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          title={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {/* The two shelves sit above the tree because they are screens, not folders: 작업공간 gathers
          every pane the app holds no matter which folder it came from, and 숨김 is the exception
          list that keeps that screen usable. Neither belongs to a group in the tree below. */}
      {collapsed ? (
        <ul className="rail-workspaces" role="list" aria-label="작업공간">
          {SHELF_KINDS.map((kind) => (
            <li key={kind}>
              <button
                type="button"
                className={[
                  "rail-workspace-button",
                  selectedShelf === kind ? "selected" : "",
                  shelfDropKind === kind ? "drop-target" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelectShelf(kind)}
                aria-label={shelfLabel(kind, shelfPaneRows[kind].length)}
                title={SHELF_TEXT[kind].name}
                {...shelfDropProps(kind)}
              >
                <ShelfIcon kind={kind} size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="workspace-shelf" aria-label="작업공간">
          {SHELF_KINDS.map((kind) => {
            const rows = shelfPaneRows[kind];
            const open = openShelves.has(kind) && rows.length > 0;
            const name = SHELF_TEXT[kind].name;
            return (
              <div className="workspace-shelf-node" key={kind}>
                <div
                  className={[
                    "workspace-shelf-row",
                    selectedShelf === kind ? "selected" : "",
                    shelfDropKind === kind ? "drop-target" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  {...shelfDropProps(kind)}
                >
                  <button
                    className="tree-toggle"
                    type="button"
                    onClick={() => toggleShelf(kind)}
                    disabled={rows.length === 0}
                    aria-label={`${name} ${open ? "접기" : "펼치기"}`}
                    title={`${name} ${open ? "접기" : "펼치기"}`}
                  >
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <button
                    className="workspace-shelf-select"
                    type="button"
                    onClick={() => onSelectShelf(kind)}
                    aria-label={shelfLabel(kind, rows.length)}
                  >
                    <ShelfIcon kind={kind} size={14} />
                    <span className="workspace-shelf-name">{name}</span>
                    {rows.length > 0 ? <span className="workspace-shelf-count">{rows.length}</span> : null}
                  </button>
                </div>
                {open ? (
                  <ul className="session-tree workspace-shelf-panes" role="group" aria-label={`${name} 패인`}>
                    {rows.map((row) => renderShelfPane(kind, row))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {collapsed ? (
        <div className="sidebar-rail-sessions" aria-label="폴더 바로가기">
          <ul role="list">{projects.map(renderRailProject)}</ul>
        </div>
      ) : (
      <nav className="project-navigation" aria-label="프로젝트">
        <div className="section-heading">
          <span>프로젝트</span>
          <button
            className="icon-button"
            type="button"
            onClick={onReload}
            disabled={loading}
            aria-label="목록 새로고침"
            title="목록 새로고침"
          >
            <RefreshCw size={16} />
          </button>
          <button
            className="icon-button"
            type="button"
            onClick={onCreateWorkProject}
            disabled={readOnly}
            aria-label="프로젝트 만들기"
            title="프로젝트 만들기"
          >
            <Briefcase size={16} />
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

        {/* Bulk expansion, on its own row rather than crowding the heading's four icons. It reaches
            the 채널 and 프로젝트 layers, which is every layer that folds — 폴더 is a leaf. */}
        <div className="tree-controls">
          <button type="button" onClick={runExpandAll} title="모든 채널과 프로젝트 펼치기">
            <ChevronsUpDown size={13} />
            <span>모두</span>
          </button>
          <button type="button" onClick={runCollapseAll} title="모든 채널과 프로젝트 접기">
            <ChevronsDownUp size={13} />
            <span>접기</span>
          </button>
          <button type="button" onClick={runExpandWorking} title="작업중인 폴더가 있는 채널과 프로젝트만 펼치기">
            <Zap size={13} />
            <span>작업중</span>
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
        ) : projects.length === 0 && workProjects.length === 0 ? (
          <div className="sidebar-empty">
            <FolderPlus size={18} aria-hidden="true" />
            <span>아직 프로젝트가 없습니다</span>
          </div>
        ) : (
          <ul
            className="project-tree"
            role="tree"
            onDragLeave={(event) => {
              // Only when the pointer actually left the list, not on every hop between rows.
              if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
              setDrag((current) => (current?.over ? { ...current, over: null } : current));
            }}
          >
            {treeNodes.map((node) =>
              node.kind === "channel" ? renderChannel(node) : renderSection(node.section),
            )}
          </ul>
        )}

        {/* 트리가 "어디에 뭐가 있나"를 답하고 나면, 그 아래가 "지금 무엇이 나를 기다리나"다. 도구
            세션도 여기 서므로 폴더 없는 세션만의 그룹은 더 이상 필요하지 않다. */}
        <SessionPanel
          items={sessionPanelItems}
          scopeTarget={sessionScopeTarget}
          scope={sessionScope}
          onChangeScope={(next) => {
            setSessionScope(next);
            persist(expandedWorkspaces, openShelves, sessionPanelOpen, next);
          }}
          open={sessionPanelOpen}
          onToggleOpen={() => {
            const next = !sessionPanelOpen;
            setSessionPanelOpen(next);
            persist(expandedWorkspaces, openShelves, next, sessionScope);
          }}
          agents={agents}
          focusedPaneId={focusedPaneId}
          onScreenPaneIds={onScreenPaneIds}
          renamingSessionId={renamingSessionId}
          onSelectSession={onSelectSession}
          onSelectDocument={onSelectDocument}
          onCloseDocument={onCloseDocument}
          onSessionContextMenu={onSessionContextMenu}
          onRenameSession={onRenameSession}
          onCancelRename={onCancelRename}
          paneDragProps={paneDragProps}
        />
      </nav>
      )}

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
        <span>세션 {sessions.length}개</span>
      </footer>
    </aside>
  );
}
