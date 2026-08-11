import type { AgentView } from "@shared/agent-types";
import type { ProjectWorkspaceSnapshot, SessionAttention, TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { WorkProject, WorkProjectRole } from "@shared/work-project-types";
import type { GitWorkspaceView, SharedWorktree } from "@shared/worktree-types";
import type { ActivePullRequestReview } from "@shared/github-types";
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderX,
  GitBranch,
  LayoutGrid,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  SquareTerminal,
  TriangleAlert,
  Wrench,
  X,
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
import { SessionNameInput } from "./SessionNameInput";
import { UpdateBadge } from "./UpdateBadge";
import { AgentIcon, GitHubIcon, TeamsIcon } from "./brand-icons";
import { DocumentPaneIcon, type DocumentPane, type PaneRow } from "./pane-items";
import { findAgent, projectName, sessionLabel, statusLabels } from "./session-labels";
import { isSessionDrag, readSessionDrag, startSessionDrag } from "./session-drag";
import { categoryAccentClass, isWorkProjectDormant } from "./work-project-accent";
import { folderActivityClass } from "./folder-status";

interface ProjectSidebarProps {
  snapshot: ProjectWorkspaceSnapshot | null;
  projects: SharedProject[];
  /** Work projects in display order; folders whose id is absent from every membership are 미분류. */
  workProjects: WorkProject[];
  projectMembership: Record<string, { workProjectId: string; role: WorkProjectRole }>;
  expandedWorkProjects: Set<string>;
  selectedWorkProjectId: string | null;
  onToggleWorkProject(workProjectId: string): void;
  onSelectWorkProject(workProjectId: string): void;
  onCreateWorkProject(): void;
  /** Null moves the folder back to 미분류. Also the drop action for cross-group drags. */
  onMoveProjectToWorkProject(projectId: string, workProjectId: string | null): void;
  /** Every session, tool sessions included: the tree gives each one a row under the folder it runs in. */
  sessions: TerminalSessionView[];
  agents: AgentView[];
  /** Every open document, listed under the folder or worktree it was opened from. */
  documentPanes: DocumentPane[];
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
  worktrees: SharedWorktree[];
  activeReviews: ActivePullRequestReview[];
  workspaceViews: GitWorkspaceView[];
  worktreeWarnings: Record<string, string>;
  selectedProjectId: string | null;
  selectedWorktreeId: string | null;
  onSelectWorktree(worktree: SharedWorktree): void;
  onWorktreeContextMenu(worktree: SharedWorktree, event: ReactMouseEvent): void;
  expandedProjects: Set<string>;
  editingProjectId: string | null;
  loading: boolean;
  loadError: string | null;
  onReload(): void;
  onAddProject(): void;
  onSelectProject(projectId: string): void;
  onToggleProject(projectId: string): void;
  onExpandAll(): void;
  onCollapseAll(): void;
  /** One-shot tidy: leaves 작업중 folders open and closes the rest. Not a mode that stays on. */
  onExpandWorking(): void;
  onReorderProjects(orderedIds: string[]): void;
  onProjectContextMenu(project: SharedProject, event: ReactMouseEvent): void;
  onProjectSaved(project: SharedProject): void;
  onCloseEditor(): void;
  onRestoreBackup(): void;
  /**
   * What each of 작업공간1/2/3 holds, in slot order. A workspace gathers panes from several folders,
   * so only App can say what an id refers to — the shelf draws the rows it is handed. The views
   * themselves stay in App, which is the single writer for slots.
   */
  workspacePaneRows: PaneRow[][];
  selectedWorkspaceIndex: number | null;
  onSelectWorkspace(index: number): void;
  /** A row dropped on 작업공간N. The pane stays in its folder view too — this is a reference. */
  onDropPaneOnWorkspace(index: number, paneId: string): void;
  /** A pane picked from an expanded 작업공간 row: show that workspace, on the page holding the pane. */
  onSelectWorkspacePane(index: number, paneId: string): void;
  /** Takes the pane off that workspace's grid and leaves the slot open. The session keeps running. */
  onRemoveFromWorkspace(index: number, paneId: string): void;
  /** The folder a jump just pointed at. It pulses for a moment, then App clears this. */
  flashProjectId: string | null;
  isHome: boolean;
  onOpenHome(): void;
  collapsed: boolean;
  onToggleCollapse(): void;
}

/**
 * Sessions keep the order they were created in. Sorting by updatedAt would shuffle the tree every
 * time a session emitted a status change, so merely opening one would jump it to the top.
 */
function byCreation(left: TerminalSessionView, right: TerminalSessionView): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

/**
 * Which tree nodes are folded away, and which 작업공간 rows are unfolded. The two are stored in one
 * record because they are one thing to the user — how much of the sidebar is showing.
 *
 * The polarities differ on purpose: a worktree node in `expandedWorkspaces` is *collapsed* (so a
 * worktree created later starts open, showing its sessions), while a shelf index in `openShelves`
 * is *expanded* (so the shelf stays a three-line summary until asked otherwise).
 */
const SIDEBAR_STATE_KEY = "multi-cli-work.sidebar.v1";

function readSidebarState(): { expandedWorkspaces: string[]; openShelves: number[] } {
  try {
    const value = JSON.parse(localStorage.getItem(SIDEBAR_STATE_KEY) ?? "{}") as {
      expandedWorkspaces?: string[];
      openShelves?: number[];
    };
    return { expandedWorkspaces: value.expandedWorkspaces ?? [], openShelves: value.openShelves ?? [] };
  } catch {
    return { expandedWorkspaces: [], openShelves: [] };
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

export function ProjectSidebar({
  snapshot,
  projects,
  workProjects,
  projectMembership,
  expandedWorkProjects,
  selectedWorkProjectId,
  onToggleWorkProject,
  onSelectWorkProject,
  onCreateWorkProject,
  onMoveProjectToWorkProject,
  sessions,
  agents,
  documentPanes,
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
  worktrees,
  activeReviews,
  workspaceViews,
  worktreeWarnings,
  selectedProjectId,
  selectedWorktreeId,
  onSelectWorktree,
  onWorktreeContextMenu,
  expandedProjects,
  editingProjectId,
  loading,
  loadError,
  onReload,
  onAddProject,
  onSelectProject,
  onToggleProject,
  onExpandAll,
  onCollapseAll,
  onExpandWorking,
  onReorderProjects,
  onProjectContextMenu,
  onProjectSaved,
  onCloseEditor,
  onRestoreBackup,
  workspacePaneRows,
  selectedWorkspaceIndex,
  onSelectWorkspace,
  onDropPaneOnWorkspace,
  onSelectWorkspacePane,
  onRemoveFromWorkspace,
  flashProjectId,
  isHome,
  onOpenHome,
  collapsed,
  onToggleCollapse,
}: ProjectSidebarProps) {
  const readOnly = Boolean(snapshot && !snapshot.writable);
  const [drag, setDrag] = useState<{ id: string; over: { id: string; position: DropPosition } | null } | null>(null);
  const [workspaceDropIndex, setWorkspaceDropIndex] = useState<number | null>(null);
  const flashRow = useRef<HTMLDivElement | null>(null);
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(
    () => new Set(readSidebarState().expandedWorkspaces),
  );
  const [openShelves, setOpenShelves] = useState<Set<number>>(() => new Set(readSidebarState().openShelves));
  // Both toggles write the whole record, so neither can drop the other's half of it.
  const persist = (workspaces: Set<string>, shelves: Set<number>) => {
    try {
      localStorage.setItem(
        SIDEBAR_STATE_KEY,
        JSON.stringify({ version: 1, expandedWorkspaces: [...workspaces], openShelves: [...shelves] }),
      );
    } catch { /* unavailable storage */ }
  };
  const toggleWorkspace = (key: string) => setExpandedWorkspaces((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    persist(next, openShelves);
    return next;
  });
  const toggleShelf = (index: number) => setOpenShelves((current) => {
    const next = new Set(current);
    if (next.has(index)) next.delete(index); else next.add(index);
    persist(expandedWorkspaces, next);
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
   * 작업공간 rows accept panes, not folders — folder drags carry only `text/plain`, so the session
   * type is what tells the two apart. The drop copies a reference: the pane keeps its folder tab.
   */
  const workspaceDropProps = (index: number) => ({
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      if (!isSessionDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setWorkspaceDropIndex(index);
    },
    onDragLeave: (event: ReactDragEvent<HTMLElement>) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      setWorkspaceDropIndex((current) => (current === index ? null : current));
    },
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      if (!isSessionDrag(event)) return;
      event.preventDefault();
      setWorkspaceDropIndex(null);
      const paneId = readSessionDrag(event);
      if (paneId) onDropPaneOnWorkspace(index, paneId);
    },
  });

  const workspaceLabel = (index: number, count: number) =>
    `작업공간${index + 1} 열기 (패인 ${count}개)`;

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

  // Sidebar sections: one per work project plus a trailing 미분류 bucket. With no work projects at
  // all, the single unlabeled section keeps the tree exactly as it was before grouping existed.
  const treeSections = useMemo(() => {
    const sections = workProjects.map((workProject) => ({
      key: workProject.id,
      workProject: workProject as WorkProject | null,
      projects: projects.filter((project) => projectMembership[project.id]?.workProjectId === workProject.id),
    }));
    const unassigned = projects.filter((project) => !projectMembership[project.id]);
    if (unassigned.length > 0 || sections.length === 0) {
      sections.push({ key: "unassigned", workProject: null, projects: unassigned });
    }
    return sections;
  }, [workProjects, projects, projectMembership]);

  const attentionOf = (candidates: TerminalSessionView[]) => rollUpAttention(candidates, unread);

  /** Sessions with no folder behind them — the 업데이트 commands, which run against the CLIs themselves. */
  const toolSessions = useMemo(
    () => sessions.filter((session) => session.projectId === null).sort(byCreation),
    [sessions],
  );

  /** Documents hang under the folder or worktree they were opened from, beside that place's sessions. */
  const documentsOf = (kind: "project" | "worktree", id: string) =>
    documentPanes.filter((pane) => pane.owner?.kind === kind && pane.owner.id === id);

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
  });

  /** `current` is the focused pane, `on-screen` the ones the grid is drawing; the rest read as dim. */
  const rowClass = (paneId: string, ...extra: string[]) =>
    [
      "session-row",
      ...extra,
      focusedPaneId === paneId ? "current" : "",
      onScreenPaneIds.has(paneId) ? "on-screen" : "",
    ]
      .filter(Boolean)
      .join(" ");

  const renderSession = (session: TerminalSessionView, peers: TerminalSessionView[]) => {
    const agent = findAgent(agents, session.kind);
    const label = sessionLabel(session, peers, agents);
    const sessionUnread = unread[session.id];
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
          className={rowClass(session.id, `status-${session.status}`)}
          type="button"
          onClick={() => onSelectSession(session)}
          onContextMenu={(event) => onSessionContextMenu(session, event)}
          aria-label={`${label} 세션 열기${sessionUnread ? " (읽지 않음)" : ""}`}
          {...paneDragProps(session.id)}
        >
          <span className={`status-dot status-${session.status}`} aria-hidden="true" />
          {session.tool ? <Wrench size={14} /> : <AgentIcon agent={agent} size={14} />}
          <span className="session-name" title={label}>
            {label}
          </span>
          {sessionUnread ? (
            <span className={`unread-dot unread-${sessionUnread}`} title="응답 대기" aria-hidden="true" />
          ) : null}
          <span className="session-status">{statusLabels[session.status]}</span>
        </button>
      </li>
    );
  };

  /**
   * A file, diff, commit graph or pull request. A sibling pair of buttons inside the row, not a
   * button nesting a button (invalid HTML — the trap `.brand-block`'s toggle hit before), so 닫기
   * can sit on the same line as 열기.
   */
  const renderDocument = (pane: DocumentPane) => (
    <li key={pane.id}>
      <div className={rowClass(pane.id, "file-tab-row")} {...paneDragProps(pane.id)}>
        <button
          type="button"
          className="file-tab-open"
          onClick={() => onSelectDocument(pane)}
          aria-label={`${pane.label} 문서 열기${pane.dirty ? " (저장 안 됨)" : ""}`}
        >
          <span className={`file-tab-dot ${pane.dirty ? "dirty" : ""}`} aria-hidden="true" />
          <DocumentPaneIcon kind={pane.kind} size={13} />
          <span className="session-name" title={pane.detail ? `${pane.label} · ${pane.detail}` : pane.label}>
            {pane.label}
          </span>
        </button>
        <button
          type="button"
          className="file-tab-close"
          onClick={() => onCloseDocument(pane)}
          aria-label={`${pane.label} 닫기`}
          title="닫기"
        >
          <X size={12} />
        </button>
      </div>
    </li>
  );

  /**
   * A pane inside an expanded 작업공간 row. It is the same row as in the tree, but it answers to the
   * workspace: clicking goes to the page of *that* workspace holding it, and ✕ takes it off that
   * grid — leaving the slot open for the next pane the app shelves — rather than closing anything.
   */
  const renderShelfPane = (index: number, row: PaneRow) => (
    <li key={row.id}>
      <div
        className={rowClass(row.id, "file-tab-row", row.kind === "session" ? `status-${row.status}` : "")}
        {...paneDragProps(row.id)}
      >
        <button
          type="button"
          className="file-tab-open"
          onClick={() => onSelectWorkspacePane(index, row.id)}
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
          onClick={() => onRemoveFromWorkspace(index, row.id)}
          aria-label={`작업공간${index + 1}에서 ${row.label} 빼기`}
          title="이 작업공간에서 빼기"
        >
          <X size={12} />
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
    const attention = attentionOf(projectSessions);
    return (
      <li key={project.id}>
        <button
          type="button"
          className={`rail-session-button ${folderActivityClass(projectSessions)} ${selectedProjectId === project.id ? "selected" : ""}`}
          onClick={() => onSelectProject(project.id)}
          onContextMenu={(event) => onProjectContextMenu(project, event)}
          title={name}
          aria-label={`${name} 폴더 선택${attention ? " (읽지 않음)" : ""}`}
        >
          <Folder size={15} />
          {attention ? <span className={`unread-dot unread-${attention}`} aria-hidden="true" /> : null}
        </button>
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

      {/* 작업공간1/2/3 sit above the tree because they are screens, not folders: a workspace gathers
          panes from anywhere — new ones shelve themselves, and any tab can be dropped in by hand — so
          it belongs to no group in the tree below. */}
      {collapsed ? (
        <ul className="rail-workspaces" role="list" aria-label="작업공간">
          {workspacePaneRows.map((rows, index) => (
            <li key={index}>
              <button
                type="button"
                className={[
                  "rail-workspace-button",
                  selectedWorkspaceIndex === index ? "selected" : "",
                  workspaceDropIndex === index ? "drop-target" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelectWorkspace(index)}
                aria-label={workspaceLabel(index, rows.length)}
                title={`작업공간${index + 1}`}
                {...workspaceDropProps(index)}
              >
                <LayoutGrid size={14} />
                <span className="rail-workspace-index" aria-hidden="true">
                  {index + 1}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="workspace-shelf" aria-label="작업공간">
          {workspacePaneRows.map((rows, index) => {
            const open = openShelves.has(index) && rows.length > 0;
            return (
              <div className="workspace-shelf-node" key={index}>
                <div
                  className={[
                    "workspace-shelf-row",
                    selectedWorkspaceIndex === index ? "selected" : "",
                    workspaceDropIndex === index ? "drop-target" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  {...workspaceDropProps(index)}
                >
                  <button
                    className="tree-toggle"
                    type="button"
                    onClick={() => toggleShelf(index)}
                    disabled={rows.length === 0}
                    aria-label={`작업공간${index + 1} ${open ? "접기" : "펼치기"}`}
                    title={`작업공간${index + 1} ${open ? "접기" : "펼치기"}`}
                  >
                    {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <button
                    className="workspace-shelf-select"
                    type="button"
                    onClick={() => onSelectWorkspace(index)}
                    aria-label={workspaceLabel(index, rows.length)}
                  >
                    <LayoutGrid size={14} />
                    <span className="workspace-shelf-name">작업공간{index + 1}</span>
                    {rows.length > 0 ? <span className="workspace-shelf-count">{rows.length}</span> : null}
                  </button>
                </div>
                {open ? (
                  <ul className="session-tree workspace-shelf-panes" role="group" aria-label={`작업공간${index + 1} 패인`}>
                    {rows.map((row) => renderShelfPane(index, row))}
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

        {/* Bulk expansion, on its own row rather than crowding the heading's four icons. Reaches the
            work project and 폴더 layers only — worktree expansion is the user's own arrangement. */}
        <div className="tree-controls">
          <button type="button" onClick={onExpandAll} title="모든 프로젝트와 폴더 펼치기">
            <ChevronsUpDown size={13} />
            <span>모두</span>
          </button>
          <button type="button" onClick={onCollapseAll} title="모든 프로젝트와 폴더 접기">
            <ChevronsDownUp size={13} />
            <span>접기</span>
          </button>
          <button type="button" onClick={onExpandWorking} title="작업중인 폴더만 펼치고 나머지는 접기">
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
            {treeSections.map((section) => {
              const workProject = section.workProject;
              const sectionExpanded = workProject ? expandedWorkProjects.has(workProject.id) : true;
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
                        aria-label={`${workProject.name} ${sectionExpanded ? "접기" : "펼치기"}`}
                        title={`${workProject.name} ${sectionExpanded ? "접기" : "펼치기"}`}
                      >
                        {sectionExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <button
                        className="work-project-select"
                        type="button"
                        onClick={() => onSelectWorkProject(workProject.id)}
                        aria-label={`${workProject.name} 프로젝트 열기`}
                      >
                        <Briefcase size={15} />
                        {/* Name only — the 구분 reads from the icon and rail colour, and the folder
                            count is one expand away. The chip and counts moved out for quiet. */}
                        <span className="project-copy">
                          <span className="project-name">{workProject.name}</span>
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
                      <ul className="project-group" role="group" aria-label={workProject.name}>
                        <li className="work-project-empty">폴더 없음 — 상세 페이지에서 추가</li>
                      </ul>
                    ) : (
            <ul className="project-group" role="group" aria-label={workProject?.name ?? "미분류"}>
            {section.projects.map((project) => {
              const name = projectName(project);
              const expanded = expandedProjects.has(project.id);
              const rootMissing = snapshot?.missingRootProjectIds.includes(project.id) ?? false;
              const projectSessions = sessions
                .filter((session) => session.projectId === project.id)
                .sort(byCreation);
              const projectWorktrees = worktrees.filter((worktree) => worktree.projectId === project.id);
              const projectWorkspaceViews = workspaceViews.filter((workspace) => workspace.projectId === project.id);
              const mainWorkspace = projectWorkspaceViews.find((workspace) => workspace.kind === "main") ?? null;
              // The main node only adds useful hierarchy when another worktree exists.
              const isGitProject = projectWorktrees.length > 0;
              // The folder row shows the strongest wait among its sessions, so a collapsed
              // folder cannot hide an agent asking for approval.
              const projectAttention = attentionOf(projectSessions);
              return (
                <li className="project-node" key={project.id} role="treeitem" aria-expanded={expanded}>
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
                      title={project.rootPath}
                    >
                      {rootMissing ? (
                        <FolderX size={15} aria-label="폴더 없음" />
                      ) : projectMembership[project.id]?.role === "docs" ? (
                        <TeamsIcon size={15} className="brand-icon-teams" />
                      ) : projectMembership[project.id]?.role === "repo" ? (
                        <GitHubIcon size={15} className="brand-icon-github" />
                      ) : expanded ? (
                        <FolderOpen size={15} />
                      ) : (
                        <Folder size={15} />
                      )}
                      {/* The dot sits inside .project-copy so it stays beside the name however
                          short the name is, rather than drifting to the far edge of the row. */}
                      <span className="project-copy">
                        <span className="folder-status-dot" aria-hidden="true" />
                        <span className="project-name">{name}</span>
                        {/* Its worktrees' sessions count too: the folder answers "how much is
                            running here", and each worktree row already breaks that down. */}
                        {projectSessions.length > 0 ? (
                          <span className="folder-session-count" title={`세션 ${projectSessions.length}개`}>
                            {projectSessions.length}
                          </span>
                        ) : null}
                      </span>
                      {projectAttention ? (
                        <span
                          className={`unread-dot unread-${projectAttention}`}
                          role="status"
                          aria-label="응답 대기 세션 있음"
                          title="응답 대기 세션 있음"
                        />
                      ) : null}
                      {rootMissing ? <span className="project-status missing-status">없음</span> : null}
                    </button>
                  </div>
                  {editingProjectId === project.id ? (
                    <ProjectMetadataEditor project={project} onSaved={onProjectSaved} onClose={onCloseEditor} />
                  ) : null}
                  {/* A plain folder opens straight onto its work; a git folder puts a worktree
                      layer in between, because there a session belongs to a checkout, not a path. */}
                  {expanded && !isGitProject ? (
                    <ul className="session-tree" role="group" aria-label={`${name} 패인`}>
                      {projectSessions
                        .filter((session) => session.worktreeId === undefined)
                        .map((session) => renderSession(session, projectSessions))}
                      {documentsOf("project", project.id).map(renderDocument)}
                    </ul>
                  ) : null}
                  {expanded && isGitProject ? (
                        <ul className="worktree-tree" role="group" aria-label={`${name} worktree`}>
                          {mainWorkspace ? <li className="worktree-node main-workspace-node" key={mainWorkspace.workspaceKey}>
                            <div className={`worktree-row two-line ${selectedProjectId === project.id && selectedWorktreeId === null ? "selected" : ""}`}>
                              <button className="tree-toggle" type="button" onClick={() => toggleWorkspace(mainWorkspace.workspaceKey)} aria-label={`메인 ${expandedWorkspaces.has(mainWorkspace.workspaceKey) ? "펼치기" : "접기"}`}>
                                {expandedWorkspaces.has(mainWorkspace.workspaceKey) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                              </button>
                              <button className="workspace-select" type="button" onClick={() => onSelectProject(project.id)} title={mainWorkspace.path}>
                                <GitBranch size={13} /><span className="workspace-copy"><span className="worktree-branch">메인 · {mainWorkspace.branch ?? `detached @ ${mainWorkspace.head?.slice(0, 7) ?? "unknown"}`}</span><span className="workspace-meta">변경 {mainWorkspace.changedFileCount} · 세션 {projectSessions.filter((session) => session.worktreeId === undefined).length}</span></span>
                              </button>
                            </div>
                            {/* A node the user folded stays folded unless it is the one on screen —
                                the selected place always shows what it holds. */}
                            {!expandedWorkspaces.has(mainWorkspace.workspaceKey) || (selectedProjectId === project.id && selectedWorktreeId === null) ? (
                              <ul className="session-tree worktree-sessions" role="group" aria-label={`${name} 메인 패인`}>
                                {projectSessions
                                  .filter((session) => session.worktreeId === undefined)
                                  .map((session) => renderSession(session, projectSessions))}
                                {documentsOf("project", project.id).map(renderDocument)}
                              </ul>
                            ) : null}
                          </li> : null}
                          {projectWorktrees.sort((left, right) => {
                            const leftReview = activeReviews.find((review) => review.worktreeId === left.id);
                            const rightReview = activeReviews.find((review) => review.worktreeId === right.id);
                            if (leftReview && rightReview) return leftReview.pullRequestNumber - rightReview.pullRequestNumber;
                            if (leftReview) return 1;
                            if (rightReview) return -1;
                            return left.branch.localeCompare(right.branch);
                          }).map((worktree) => {
                            const view = projectWorkspaceViews.find((workspace) => workspace.worktreeId === worktree.id);
                            const pullRequestReview = activeReviews.find((review) => review.worktreeId === worktree.id);
                            const worktreeSessions = projectSessions.filter(
                              (session) => session.worktreeId === worktree.id,
                            );
                            const worktreeAttention = attentionOf(worktreeSessions);
                            const worktreeDocuments = documentsOf("worktree", worktree.id);
                            return (
                              <li className="worktree-node" key={worktree.id}>
                                <div className={`worktree-row two-line ${selectedWorktreeId === worktree.id ? "selected" : ""}`} onContextMenu={(event) => onWorktreeContextMenu(worktree, event)}>
                                  <button className="tree-toggle" type="button" onClick={() => toggleWorkspace(`worktree:${worktree.id}`)} aria-label={`${worktree.branch} ${expandedWorkspaces.has(`worktree:${worktree.id}`) ? "펼치기" : "접기"}`}>
                                    {expandedWorkspaces.has(`worktree:${worktree.id}`) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                                  </button>
                                  <button className="workspace-select" type="button" onClick={() => onSelectWorktree(worktree)} aria-label={`${worktree.branch} worktree 선택`} title={worktree.path}>
                                    <GitBranch size={13} aria-hidden="true" />
                                    <span className="workspace-copy"><span className="worktree-branch">{pullRequestReview ? `PR #${pullRequestReview.pullRequestNumber} · 임시` : view?.branch ?? (view?.head ? `detached @ ${view.head.slice(0, 7)}` : worktree.branch)}{view?.lockedReason ? " · locked" : ""}{view?.availability === "missing" ? " · missing" : ""}{view?.prunableReason ? " · prunable" : ""}</span><span className="workspace-meta">변경 {view?.changedFileCount ?? 0} · 세션 {worktreeSessions.length}</span></span>
                                    {worktreeAttention ? (
                                    <span
                                      className={`unread-dot unread-${worktreeAttention}`}
                                      title="응답 대기"
                                      aria-hidden="true"
                                    />
                                    ) : null}
                                  </button>
                                </div>
                                {(!expandedWorkspaces.has(`worktree:${worktree.id}`) || selectedWorktreeId === worktree.id) &&
                                (worktreeSessions.length > 0 || worktreeDocuments.length > 0) ? (
                                  <ul className="session-tree worktree-sessions" role="group" aria-label={`${worktree.branch} 패인`}>
                                    {worktreeSessions.map((session) => renderSession(session, projectSessions))}
                                    {worktreeDocuments.map(renderDocument)}
                                  </ul>
                                ) : null}
                              </li>
                            );
                          })}
                          {worktreeWarnings[project.id] ? <li className="project-worktree-warning" role="status"><TriangleAlert size={13} />{worktreeWarnings[project.id]}</li> : null}
                        </ul>
                  ) : null}
                </li>
              );
            })}
            </ul>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {/* Maintenance sessions belong to no folder, so they get a group of their own at the foot
            of the tree rather than being hidden until something goes wrong. */}
        {toolSessions.length > 0 ? (
          <div className="tools-group">
            <div className="section-heading">
              <span>도구</span>
            </div>
            <ul className="session-tree" role="group" aria-label="유지보수 세션">
              {toolSessions.map((session) => renderSession(session, toolSessions))}
            </ul>
          </div>
        ) : null}
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
