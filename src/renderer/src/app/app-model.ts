import type { GitDiffResult, ProviderAvailability, TerminalSessionView } from "@shared/api-types";
import type { SlotViewState } from "@shared/app-state-types";
import type { FileExplorerTarget } from "@shared/file-explorer-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalEvent } from "@shared/terminal-types";
import type { SharedWorktree } from "@shared/worktree-types";
import type { GitDiffFile } from "../GitDiffPane";
import { DEFAULT_LAYOUT_ID } from "../grid-layouts";
import type { Shelves } from "../shelves";
import { normalizeSlots, pruneFolderViews } from "../slot-view";

/**
 * App의 화면 상태 모델: 패널·메뉴 상태의 모양과, 저장된 배치를 되살리는 순수 함수. App.tsx에서 옮겨 왔다.
 */

export type ActiveView = "home" | "detail" | "work-project" | "terminal";

/**
 * A grid belongs to a surface, and a surface is either a folder (a project, or one of its
 * worktrees, or the tool sessions that belong to none) or one of the two shelves. Folder surfaces
 * are keyed by a string so they can all live in one persisted record; the prefixes keep a
 * worktree's grid from colliding with a project id.
 */
export const TOOLS_VIEW_KEY = "@tools";

export function folderViewKeyOf(projectId: string | null, worktreeId: string | null): string {
  if (worktreeId) return `@worktree:${worktreeId}`;
  return projectId ?? TOOLS_VIEW_KEY;
}

export const EMPTY_VIEW: SlotViewState = { layoutId: DEFAULT_LAYOUT_ID, slots: [] };

/** 작업공간 and 숨김 always exist, even before anything has been put on either. */
export function emptyShelves(): Shelves {
  return {
    active: { layoutId: DEFAULT_LAYOUT_ID, slots: [] },
    hidden: { layoutId: DEFAULT_LAYOUT_ID, slots: [] },
  };
}

/**
 * Restores the two shelves. Main has already folded a pre-v1.20 file's 작업공간1/2/3 into the single
 * `workspace`, and a file from before v1.14.0 has neither but does carry `visibleSessionIds` — the
 * panes that were on screen when the app last closed. Those become the 작업공간, so an upgrade never
 * opens on an arrangement the user never asked for.
 *
 * Coming back short is safe: what matters is which panes were hidden, and the reconciler collects
 * everything else into 작업공간 on the first pass.
 */
export function restoreShelves(
  savedWorkspace: SlotViewState | undefined,
  savedHiddenPanes: SlotViewState | undefined,
  legacyVisibleSessionIds: readonly string[] | undefined,
  paneIds: readonly string[],
): Shelves {
  const source =
    savedWorkspace ??
    (legacyVisibleSessionIds && legacyVisibleSessionIds.length > 0
      ? { layoutId: DEFAULT_LAYOUT_ID, slots: [...legacyVisibleSessionIds] }
      : undefined);
  return {
    active: normalizeSlots(source, [], { keep: paneIds }),
    hidden: normalizeSlots(savedHiddenPanes, [], { keep: paneIds }),
  };
}

export function restoreFolderViews(
  saved: Readonly<Record<string, SlotViewState>> | undefined,
  paneIds: readonly string[],
  projectIds: ReadonlySet<string>,
  worktreeIds: ReadonlySet<string>,
): Record<string, SlotViewState> {
  return Object.fromEntries(
    Object.entries(pruneFolderViews(saved ?? {}, projectIds, worktreeIds, TOOLS_VIEW_KEY)).map(([key, view]) => [
      key,
      normalizeSlots(view, [], { keep: paneIds }),
    ]),
  );
}

export const ACTIVITY_LOG_LIMIT = 20;

export const EMPTY_AVAILABILITY: ProviderAvailability = { vscode: false };
export const DEFAULT_SIDEBAR_WIDTH = 264;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 420;
export const MIN_WORKSPACE_WIDTH = 480;
export const SIDEBAR_RESIZER_WIDTH = 4;
export const SIDEBAR_RAIL_WIDTH = 52;
export const DEFAULT_RIGHT_SIDEBAR_WIDTH = 280;
export const MIN_RIGHT_SIDEBAR_WIDTH = 220;
export const MAX_RIGHT_SIDEBAR_WIDTH = 480;
export const RIGHT_SIDEBAR_RAIL_WIDTH = 36;
/**
 * 두 층 모두 무엇이 *접혔는지*를 적는다 — 그래야 나중에 생긴 폴더나 프로젝트가 펼쳐진 채로
 * 시작한다. 폴더 키는 v1.27에서 세션 행이 트리를 떠났을 때 읽기를 멈췄을 뿐 지우지는 않았으므로,
 * 다시 읽는 지금 업그레이드 전의 배치가 그대로 돌아온다. 두 키의 기록자는 `persistCollapsed` 하나다.
 */
export const COLLAPSED_PROJECTS_KEY = "multi-cli-work.projects.v1";
export const COLLAPSED_WORK_PROJECTS_KEY = "multi-cli-work.work-projects.v1";

export function persistCollapsed(key: string, collapsed: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify({ version: 1, collapsed: [...collapsed] }));
  } catch { /* unavailable storage */ }
}

/**
 * A document opened from the right-hand sidebar. It takes a slot exactly like a terminal does, so
 * a diff can sit beside the session that produced it rather than replacing the whole workspace.
 * Files are not here: `openFileTabs` already holds their content, and their pane id points at it.
 */
export type OpenDocument =
  | { id: string; kind: "diff"; file: GitDiffFile }
  | { id: string; kind: "graph"; target: FileExplorerTarget; targetLabel: string | null }
  | { id: string; kind: "pull-request"; projectId: string; remoteName: string; number: number; label: string };

export function documentTargetKey(target: FileExplorerTarget): string {
  return `${target.kind}:${target.id}`;
}

export interface ContextMenuState {
  project: SharedProject;
  x: number;
  y: number;
}

export interface RemovalState {
  project: SharedProject;
  sessionCount: number;
}

export interface SessionMenuState {
  session: TerminalSessionView;
  label: string;
  /** Where the right-click happened, so 이름 변경 opens its input on that surface and not the other. */
  surface: RenameSurface;
  x: number;
  y: number;
}

/**
 * A session now has a row in the sidebar *and* a pane header, and both can rename it. Remembering
 * which one asked keeps a single `SessionNameInput` on screen instead of two sharing one state.
 */
export type RenameSurface = "sidebar" | "pane";

export interface WorktreeMenuState {
  worktree: SharedWorktree;
  x: number;
  y: number;
}

export interface WorktreeRemovalState {
  worktree: SharedWorktree;
  sessionCount: number;
}

/** The second, force-only confirmation after git refused because of uncommitted changes. */
export interface WorktreeForceState {
  worktree: SharedWorktree;
  message: string;
}

export interface DiffViewState {
  title: string;
  result: GitDiffResult;
}

export function replaceSession(sessions: TerminalSessionView[], next: TerminalSessionView): TerminalSessionView[] {
  const index = sessions.findIndex((session) => session.id === next.id);
  if (index === -1) return [...sessions, next];
  return sessions.map((session) => (session.id === next.id ? next : session));
}

export function mergeAttachedSession(sessions: TerminalSessionView[], attached: TerminalSessionView): TerminalSessionView[] {
  return sessions.map((current) => {
    if (current.id !== attached.id) return current;
    const currentFinished = current.status === "exited" || current.status === "error";
    const attachedFinished = attached.status === "exited" || attached.status === "error";
    const resumedAfterShutdown = current.interruptedByShutdown
      && !attachedFinished
      && !attached.interruptedByShutdown;
    return currentFinished && !attachedFinished && !resumedAfterShutdown ? current : attached;
  });
}

export function applyEvent(session: TerminalSessionView, event: TerminalEvent): TerminalSessionView {
  if (event.type === "status") return { ...session, status: event.status };
  if (event.type === "title") return { ...session, title: event.title };
  if (event.type === "exit") {
    return { ...session, status: "exited", pid: null, exitCode: event.exitCode };
  }
  return session;
}
