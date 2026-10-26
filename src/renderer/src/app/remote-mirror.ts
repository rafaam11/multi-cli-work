import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { ActivePullRequestReview } from "@shared/github-types";
import type {
  RemoteMirror,
  RemoteMirrorFolder,
  RemoteMirrorPlace,
  RemoteMirrorSection,
  RemoteMirrorSlot,
} from "@shared/remote-types";
import type { WorkProjectRole } from "@shared/work-project-types";
import { isWorkingWorktree } from "@shared/working-branches";
import type { GitWorkspaceView, SharedWorktree } from "@shared/worktree-types";
import type { DocumentPane } from "../pane-items";
import { projectName, sessionLabel } from "../session-labels";
import type { ShelfKind } from "../shelves";
import type { TreeSection } from "../sidebar-tree";
import type { ResolvedView } from "../slot-view";
import type { ResolvedTheme } from "../theme";
import type { ActiveView } from "./app-model";

/** 원격 창이 호스트 화면을 따라 그리는 데 필요한 것. 모두 App이 이미 가진 값이다. */
export interface RemoteMirrorSources {
  sections: readonly TreeSection[];
  sessions: readonly TerminalSessionView[];
  worktrees: readonly SharedWorktree[];
  workspaceViews: readonly GitWorkspaceView[];
  activeReviews: readonly ActivePullRequestReview[];
  projectMembership: Readonly<Record<string, { role: WorkProjectRole }>>;
  missingRootProjectIds: readonly string[];
  documentPanes: readonly Pick<DocumentPane, "id" | "label">[];
  activeView: ActiveView;
  shelfKind: ShelfKind | null;
  selectedProjectId: string | null;
  selectedWorktreeId: string | null;
  /** 저장된 배치의 레이아웃 id — 자동이면 "auto"다. 그리는 모양은 resolvedView가 갖는다. */
  layoutId: string;
  resolvedView: ResolvedView;
  focusedPaneId: string | null;
  /** 그리드가 화면에 나와 있는지(App의 showsGrid). 아니면 시작 화면이 떠 있다. */
  showsGrid: boolean;
  zoomedPaneId: string | null;
  agents: readonly AgentView[];
  theme: ResolvedTheme;
}

/** 사이드바와 같은 순서: 만든 순서대로. */
function byCreation(left: TerminalSessionView, right: TerminalSessionView): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

/**
 * 사이드바 프로젝트 영역 한 폴더. ProjectSidebar가 그리는 규칙을 그대로 따른다 — 봇 브랜치 worktree는
 * 빼고 그 세션은 루트로, PR 리뷰 체크아웃은 아래로, 나머지는 브랜치 이름순.
 */
function mirrorFolder(project: TreeSection["projects"][number], sources: RemoteMirrorSources): RemoteMirrorFolder {
  const projectSessions = sources.sessions.filter((session) => session.projectId === project.id).slice().sort(byCreation);
  const allWorktrees = sources.worktrees.filter((worktree) => worktree.projectId === project.id);
  const ignored = new Set(
    allWorktrees
      .filter((worktree) => !isWorkingWorktree(worktree, sources.workspaceViews))
      .map((worktree) => worktree.id),
  );
  const worktrees = allWorktrees.filter((worktree) => !ignored.has(worktree.id));
  const rootSessions = projectSessions.filter(
    (session) => session.worktreeId === undefined || ignored.has(session.worktreeId),
  );
  const views = sources.workspaceViews.filter((workspace) => workspace.projectId === project.id);
  const mainWorkspace = views.find((workspace) => workspace.kind === "main") ?? null;
  const reviewOf = (worktreeId: string) => sources.activeReviews.find((review) => review.worktreeId === worktreeId);
  const role = sources.projectMembership[project.id]?.role;
  return {
    id: project.id,
    name: projectName(project),
    missing: sources.missingRootProjectIds.includes(project.id),
    ...(role ? { role } : {}),
    sessionIds: projectSessions.map((session) => session.id),
    main:
      worktrees.length > 0 && mainWorkspace
        ? {
            branch: mainWorkspace.branch ?? `detached @ ${mainWorkspace.head?.slice(0, 7) ?? "unknown"}`,
            changedFileCount: mainWorkspace.changedFileCount,
          }
        : null,
    rootSessionIds: rootSessions.map((session) => session.id),
    worktrees: worktrees
      .slice()
      .sort((left, right) => {
        const leftReview = reviewOf(left.id);
        const rightReview = reviewOf(right.id);
        if (leftReview && rightReview) return leftReview.pullRequestNumber - rightReview.pullRequestNumber;
        if (leftReview) return 1;
        if (rightReview) return -1;
        return left.branch.localeCompare(right.branch);
      })
      .map((worktree) => {
        const view = views.find((workspace) => workspace.worktreeId === worktree.id);
        const review = reviewOf(worktree.id);
        return {
          id: worktree.id,
          branch: review
            ? `PR #${review.pullRequestNumber} · 임시`
            : (view?.branch ?? (view?.head ? `detached @ ${view.head.slice(0, 7)}` : worktree.branch)),
          changedFileCount: view?.changedFileCount ?? 0,
          sessionIds: projectSessions.filter((session) => session.worktreeId === worktree.id).map((session) => session.id),
        };
      }),
  };
}

function mirrorPlace(sources: RemoteMirrorSources): RemoteMirrorPlace {
  if (sources.activeView !== "terminal") return { kind: "other" };
  if (sources.shelfKind !== null) return { kind: "shelf", shelf: sources.shelfKind };
  if (sources.selectedProjectId === null) return { kind: "other" };
  return { kind: "folder", projectId: sources.selectedProjectId, worktreeId: sources.selectedWorktreeId };
}

/**
 * 호스트 메인 창이 지금 보여 주는 것의 스냅숏. 원격은 이것만 보고 같은 트리와 그리드를 그린다 —
 * 트리 규칙과 자동 레이아웃을 원격에서 다시 계산하지 않으니 둘이 어긋날 일이 없다.
 */
export function buildRemoteMirror(sources: RemoteMirrorSources): RemoteMirror {
  const tree: RemoteMirrorSection[] = sources.sections.map((section) => ({
    workProject: section.workProject ? { id: section.workProject.id, name: section.workProject.name } : null,
    folders: section.projects.map((project) => mirrorFolder(project, sources)),
  }));
  const place = mirrorPlace(sources);
  const documents = new Map(sources.documentPanes.map((pane) => [pane.id, pane.label]));
  const sessionIds = new Set(sources.sessions.map((session) => session.id));
  const { resolvedView } = sources;
  // 호스트에 시작 화면이 떠 있으면 원격도 그리드를 그리지 않는다.
  const grid = place.kind !== "other" && sources.showsGrid;
  const slots: RemoteMirrorSlot[] = grid
    ? resolvedView.slots.map((id) => {
        if (id === null) return null;
        const label = documents.get(id);
        if (label !== undefined) return { kind: "document", id, label };
        // 지워진 세션의 id는 배치가 따라잡을 때까지 남는다 — 호스트처럼 빈 칸으로 그린다.
        return sessionIds.has(id) ? { kind: "session", id } : null;
      })
    : [];
  const labels: Record<string, string> = {};
  for (const session of sources.sessions) {
    const peers = sources.sessions.filter((peer) => peer.projectId === session.projectId);
    labels[session.id] = sessionLabel(session, peers, sources.agents);
  }
  return {
    tree,
    view: {
      place,
      layoutId: sources.layoutId,
      columnRows: grid ? [...resolvedView.layout.columnRows] : [],
      page: resolvedView.page,
      pages: resolvedView.pages,
      focusedPaneId: sources.focusedPaneId,
      zoomedPaneId: grid ? sources.zoomedPaneId : null,
      slots,
    },
    theme: sources.theme,
    labels,
  };
}
