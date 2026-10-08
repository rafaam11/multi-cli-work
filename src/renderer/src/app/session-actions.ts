import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { SlotViewState } from "@shared/app-state-types";
import type { SharedProject } from "@shared/project-types";
import { DEFAULT_TERMINAL_SIZE, type TerminalKind, type ToolCommand } from "@shared/terminal-types";
import type { SharedWorktree } from "@shared/worktree-types";
import type { Dispatch, SetStateAction } from "react";
import { errorMessage } from "../ipc-error";
import { isDocumentPaneId } from "../pane-items";
import { findAgent } from "../session-labels";
import type { ShelfKind } from "../shelves";
import { appendSession, placeInSlot } from "../slot-view";
import { mergeAttachedSession, replaceSession, type ActiveView } from "./app-model";
import { pendingRunner } from "./pending";

export interface SessionContext {
  agents: readonly AgentView[];
  isProjectMissing: (projectId: string | null) => boolean;
  setPendingAction: Dispatch<SetStateAction<boolean>>;
  setActionError: Dispatch<SetStateAction<string | null>>;
  setSessions: Dispatch<SetStateAction<TerminalSessionView[]>>;
  revealSession: (session: TerminalSessionView) => void;
  placeInFolderView: (target: { paneId: string; projectId: string | null; worktreeId: string | null }) => SlotViewState;
  flashFolder: (projectId: string | null) => void;
  placePaneOnCurrentView: (paneId: string, place: (view: SlotViewState) => SlotViewState) => void;
  absoluteSlot: (index: number) => number;
  focusPane: (paneId: string) => void;
  shelfKind: ShelfKind | null;
  selectedProject: SharedProject | null;
  selectedWorktree: SharedWorktree | null;
  focusedPaneId: string | null;
  sessions: TerminalSessionView[];
  projects: SharedProject[];
  selectedSession: TerminalSessionView | null;
  persistSelection: (projectId: string | null, sessionId: string | null) => void;
  refreshingSessionIds: ReadonlySet<string>;
  setRefreshingSessionIds: Dispatch<SetStateAction<Set<string>>>;
  activeView: ActiveView;
  visibleSessionIds: string[];
  setRefreshRequests: Dispatch<SetStateAction<Record<string, number>>>;
  setFocusedPaneId: Dispatch<SetStateAction<string | null>>;
  selectedSessionId: string | null;
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  setActiveView: Dispatch<SetStateAction<ActiveView>>;
}

/**
 * 세션을 시작하고(사이드바·빈 슬롯·머리줄·도구), 재개·중지·새로 그리기·삭제하는 동작들. App이 매
 * 렌더 부르며, 동작은 그 렌더의 상태를 본다 — App 안에 두었을 때와 같다.
 */
export function createSessionActions(context: SessionContext) {
  const {
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
  } = context;

  const whilePending = pendingRunner(setPendingAction, setActionError);

  const startSession = async (project: SharedProject, kind: TerminalKind, worktreeId?: string) => {
    if (isProjectMissing(project.id) || !findAgent(agents, kind)?.available) return;
    await whilePending(async () => {
      const created = await window.multiCliWork.terminals.create({
        projectId: project.id,
        kind,
        ...(worktreeId !== undefined ? { worktreeId } : {}),
        ...DEFAULT_TERMINAL_SIZE,
      });
      setSessions((current) => replaceSession(current, created));
      // The new pane takes the next free slot of its folder's grid — nothing already on screen is
      // pushed off. 작업공간 picks it up on its own; nothing has to say so here.
      revealSession(created);
    });
  };

  /**
   * The sidebar's context menus start a session without going to it. The pane still takes its slot
   * in the folder's grid and still gets shelved, so it shows up wherever it belongs — but the page,
   * the selection and the keyboard focus stay where the user left them, and the folder row's flash
   * is the only thing that says where the session landed. Adding work is not switching to it.
   */
  const startSessionInBackground = async (project: SharedProject, kind: TerminalKind, worktreeId?: string) => {
    if (isProjectMissing(project.id) || !findAgent(agents, kind)?.available) return;
    await whilePending(async () => {
      const created = await window.multiCliWork.terminals.create({
        projectId: project.id,
        kind,
        ...(worktreeId !== undefined ? { worktreeId } : {}),
        ...DEFAULT_TERMINAL_SIZE,
        background: true,
      });
      setSessions((current) => replaceSession(current, created));
      placeInFolderView({ paneId: created.id, projectId: project.id, worktreeId: worktreeId ?? null });
      flashFolder(project.id);
    });
  };

  /**
   * An empty slot's ＋ 새 세션, and the header's. The session is started for another folder than the
   * one on screen, so it is placed twice: `placeInFolderView` gives it its slot in its own folder's
   * grid — it is already there when the user goes to that folder — and the second placement moves it
   * onto the surface in front of them. When those are the same view the second wins, because both
   * placements take a pane out of its old slot before inserting it.
   *
   * A null `slotIndex` is the header's launchers and its 새 세션 button: they aim at a surface, not
   * at a place on it, so the pane joins the end. That is also what `자동` would do with any index,
   * since the arrangement closes every gap.
   *
   * Nothing navigates: the page, the selected folder and the active view stay put, which is the
   * whole point of starting from here rather than from the sidebar.
   */
  const startSessionInSlot = async (
    project: SharedProject,
    kind: TerminalKind,
    worktreeId: string | null,
    slotIndex: number | null,
  ) => {
    if (isProjectMissing(project.id) || !findAgent(agents, kind)?.available) return;
    await whilePending(async () => {
      const created = await window.multiCliWork.terminals.create({
        projectId: project.id,
        kind,
        ...(worktreeId !== null ? { worktreeId } : {}),
        ...DEFAULT_TERMINAL_SIZE,
        background: true,
      });
      setSessions((current) => replaceSession(current, created));
      placeInFolderView({ paneId: created.id, projectId: project.id, worktreeId });
      placePaneOnCurrentView(created.id, (view) =>
        slotIndex === null ? appendSession(view, created.id) : placeInSlot(view, absoluteSlot(slotIndex), created.id),
      );
      focusPane(created.id);
      flashFolder(project.id);
    });
  };

  /**
   * The header's launchers. On a folder surface they start in the folder on screen, and going to
   * the new session is the point. A shelf belongs to no folder, so they start where the focused pane
   * already is — same folder, same worktree — and the pane joins the shelf in front of the user
   * rather than pulling them off it onto that folder's grid.
   */
  const startSessionFromHeader = (kind: TerminalKind) => {
    if (shelfKind === null) {
      if (selectedProject) void startSession(selectedProject, kind, selectedWorktree?.id);
      return;
    }
    const focused =
      focusedPaneId !== null && !isDocumentPaneId(focusedPaneId)
        ? (sessions.find((candidate) => candidate.id === focusedPaneId) ?? null)
        : null;
    if (!focused?.projectId) return;
    const project = projects.find((candidate) => candidate.id === focused.projectId);
    if (!project) return;
    void startSessionInSlot(project, kind, focused.worktreeId ?? null, null);
  };

  const startTool = async (tool: ToolCommand) => {
    await whilePending(async () => {
      const created = await window.multiCliWork.terminals.createTool({ tool, ...DEFAULT_TERMINAL_SIZE });
      setSessions((current) => replaceSession(current, created));
      revealSession(created);
    });
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
    await whilePending(async () => {
      const resumed = await window.multiCliWork.terminals.resume({
        sessionId: target.id,
        ...DEFAULT_TERMINAL_SIZE,
      });
      setSessions((current) => replaceSession(current, resumed));
      persistSelection(resumed.projectId, resumed.id);
    });
  };

  const stopSession = async (target: TerminalSessionView | null = selectedSession) => {
    if (!target) return;
    await whilePending(async () => {
      await window.multiCliWork.terminals.stop(target.id);
    });
  };

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

  /**
   * The header's one refresh. Rebuilding a terminal is about the pane it is drawn in, not about the
   * session behind it, so the button acts on everything the page is showing — the panes that would
   * each have needed their own click. Sessions already refreshing are skipped by `refreshSession`.
   */
  const refreshVisibleSessions = () => {
    for (const sessionId of visibleSessionIds) void refreshSession(sessionId);
  };

  const removeSessionById = async (session: TerminalSessionView) => {
    await whilePending(async () => {
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
    });
  };

  return {
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
  };
}
