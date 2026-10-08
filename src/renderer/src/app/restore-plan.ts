import type { TerminalSessionView } from "@shared/api-types";
import type { AppStateV1, SlotViewState } from "@shared/app-state-types";
import type { SharedProject } from "@shared/project-types";
import type { SharedWorktree } from "@shared/worktree-types";
import type { Shelves } from "../shelves";
import { normalizeSlots } from "../slot-view";
import { folderViewKeyOf, restoreFolderViews, restoreShelves, type ActiveView } from "./app-model";

/** 마지막으로 연 워크트리를 기억하는 localStorage 키. 값은 `worktree:<id>`. */
export const LAST_WORKSPACE_KEY = "multi-cli-work.last-workspace.v1";

export interface RestoreInput {
  projects: Readonly<Record<string, SharedProject>>;
  sessions: readonly TerminalSessionView[];
  worktrees: readonly SharedWorktree[];
  state: AppStateV1;
  /** 다시 읽기처럼 화면에 있던 선택을 지켜야 할 때. 없으면 저장된 선택을 되살린다. */
  preservedSelection?: { projectId: string | null; sessionId: string | null; view?: ActiveView };
  /** LAST_WORKSPACE_KEY에 저장된 값. */
  savedWorkspaceKey: string | null;
  collapsedProjectIds: ReadonlySet<string>;
}

export interface RestorePlan {
  expandedProjects: Set<string>;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  selectedWorktreeId: string | null;
  focusedPaneId: string | null;
  folderViews: Record<string, SlotViewState>;
  shelves: Shelves;
  activeView: ActiveView;
}

/**
 * 앱을 열거나 다시 읽을 때 무엇을 보여 줄지. 저장된(또는 지켜야 할) 선택을 되살리고, 없으면 첫 폴더와
 * 그 폴더에서 가장 최근에 쓴 세션을 고른다. 열리는 폴더의 그리드는 저장된 배치에 그 뒤 생긴 세션을
 * 최근 순으로 덧붙인다.
 */
export function planRestore(input: RestoreInput): RestorePlan {
  const { projects, sessions, worktrees, state, preservedSelection, savedWorkspaceKey, collapsedProjectIds } = input;
  const forceHome = preservedSelection?.view === "home";
  const visibleProjects = Object.values(projects).sort(
    (left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER),
  );
  const expandedProjects = new Set(
    visibleProjects.filter((project) => !collapsedProjectIds.has(project.id)).map((project) => project.id),
  );
  const savedWorktree = !preservedSelection && savedWorkspaceKey?.startsWith("worktree:")
    ? worktrees.find((worktree) => worktree.id === savedWorkspaceKey.slice("worktree:".length)) ?? null
    : null;
  const preferredProjectId = preservedSelection ? preservedSelection.projectId : savedWorktree?.projectId ?? state.selectedProjectId;
  const preferredSessionId = preservedSelection ? preservedSelection.sessionId : state.selectedSessionId;
  const restoredSession = sessions.find((session) => session.id === preferredSessionId) ?? null;
  const paneIds = sessions.map((session) => session.id);
  // A folder's grid catches up on the sessions it does not list yet, most recently active
  // first — the arrangement the user saved, plus whatever was started since.
  const recentIds = (matches: (session: TerminalSessionView) => boolean) =>
    sessions
      .filter(matches)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((session) => session.id);
  const restoreViews = (key: string, sessionIds: string[]) => {
    const folderViews = restoreFolderViews(
      state.folderViews,
      paneIds,
      new Set(Object.keys(projects)),
      new Set(worktrees.map((worktree) => worktree.id)),
    );
    folderViews[key] = normalizeSlots(folderViews[key], sessionIds, { autoAppend: true, keep: paneIds });
    return {
      folderViews,
      shelves: restoreShelves(state.workspace, state.hiddenPanes, state.visibleSessionIds, paneIds),
    };
  };

  // A maintenance session belongs to no folder, so restoring it must not fall back to the
  // first folder in the list the way a plain "nothing selected" state does.
  if (restoredSession?.projectId === null) {
    return {
      expandedProjects,
      selectedProjectId: null,
      selectedSessionId: restoredSession.id,
      selectedWorktreeId: null,
      focusedPaneId: restoredSession.id,
      ...restoreViews(folderViewKeyOf(null, null), recentIds((session) => session.projectId === null)),
      activeView: forceHome ? "home" : "terminal",
    };
  }

  const restoredProject = visibleProjects.find((project) => project.id === preferredProjectId) ?? null;
  const initialProject = restoredProject ?? visibleProjects[0] ?? null;
  const initialSession = restoredProject
    ? restoredSession?.projectId === restoredProject.id
      ? restoredSession
      : null
    : initialProject
      ? (sessions
          .filter((session) => session.projectId === initialProject.id)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null)
      : null;
  const initialWorktreeId =
    initialSession?.worktreeId ??
    (savedWorktree && savedWorktree.projectId === initialProject?.id ? savedWorktree.id : null);

  return {
    expandedProjects,
    selectedProjectId: initialProject?.id ?? null,
    selectedSessionId: initialSession?.id ?? null,
    selectedWorktreeId: initialWorktreeId,
    focusedPaneId: initialSession?.id ?? null,
    ...restoreViews(
      folderViewKeyOf(initialProject?.id ?? null, initialWorktreeId),
      initialWorktreeId
        ? recentIds((session) => session.worktreeId === initialWorktreeId)
        : initialProject
          ? recentIds((session) => session.projectId === initialProject.id)
          : recentIds((session) => session.projectId === null),
    ),
    activeView: forceHome ? "home" : initialSession ? "terminal" : initialProject ? "detail" : "home",
  };
}
