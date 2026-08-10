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
import { UpdateBadge } from "./UpdateBadge";
import { GitHubIcon, TeamsIcon } from "./brand-icons";
import { projectName } from "./session-labels";
import { isSessionDrag, readSessionDrag } from "./session-drag";
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
  /** Sessions never get rows of their own any more — they feed the folder and worktree badges. */
  sessions: TerminalSessionView[];
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
   * 작업공간1/2/3 are fixed in number, so the shelf takes only how full each one is — the views
   * themselves stay in App, which is the single writer for slots.
   */
  workspacePaneCounts: number[];
  selectedWorkspaceIndex: number | null;
  onSelectWorkspace(index: number): void;
  /** A tab or pane dropped on 작업공간N. The pane stays in its folder view too — this is a reference. */
  onDropPaneOnWorkspace(index: number, paneId: string): void;
  /** The folder a tab click just pointed at. It pulses for a moment, then App clears this. */
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
  workspacePaneCounts,
  selectedWorkspaceIndex,
  onSelectWorkspace,
  onDropPaneOnWorkspace,
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
  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem("multi-cli-work.sidebar.v1") ?? "{}") as { expandedWorkspaces?: string[] };
      return new Set(value.expandedWorkspaces ?? []);
    } catch { return new Set(); }
  });
  const toggleWorkspace = (key: string) => setExpandedWorkspaces((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    localStorage.setItem("multi-cli-work.sidebar.v1", JSON.stringify({ version: 1, expandedWorkspaces: [...next] }));
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

      {/* 작업공간1/2/3 sit above the tree because they are screens, not folders: a workspace is a
          hand-picked set of panes from anywhere, so it belongs to no group in the tree below. */}
      {collapsed ? (
        <ul className="rail-workspaces" role="list" aria-label="작업공간">
          {workspacePaneCounts.map((count, index) => (
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
                aria-label={workspaceLabel(index, count)}
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
          {workspacePaneCounts.map((count, index) => (
            <button
              key={index}
              type="button"
              className={[
                "workspace-shelf-row",
                selectedWorkspaceIndex === index ? "selected" : "",
                workspaceDropIndex === index ? "drop-target" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onSelectWorkspace(index)}
              aria-label={workspaceLabel(index, count)}
              {...workspaceDropProps(index)}
            >
              <LayoutGrid size={14} />
              <span className="workspace-shelf-name">작업공간{index + 1}</span>
              {count > 0 ? <span className="workspace-shelf-count">{count}</span> : null}
            </button>
          ))}
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
                  {/* The tree stops at the folder: sessions and documents are the grid's business,
                      so a git folder opens onto its worktrees and a plain one onto nothing. */}
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
