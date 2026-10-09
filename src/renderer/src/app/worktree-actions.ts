import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { SharedWorktree, WorktreeCreateResult, WorktreeRemovalResult } from "@shared/worktree-types";
import type { Dispatch, SetStateAction } from "react";
import { errorMessage } from "../ipc-error";
import { projectName } from "../session-labels";
import type { ActiveView, DiffViewState, WorktreeForceState, WorktreeRemovalState } from "./app-model";
import { pendingRunner } from "./pending";

export interface WorktreeContext {
  setWorktreeCreateProject: Dispatch<SetStateAction<SharedProject | null>>;
  setWorktrees: Dispatch<SetStateAction<SharedWorktree[]>>;
  selectWorktree: (worktree: SharedWorktree) => void;
  setActionError: Dispatch<SetStateAction<string | null>>;
  projects: readonly SharedProject[];
  setDiffView: Dispatch<SetStateAction<DiffViewState | null>>;
  sessions: readonly TerminalSessionView[];
  setWorktreeRemoval: Dispatch<SetStateAction<WorktreeRemovalState | null>>;
  setSessions: Dispatch<SetStateAction<TerminalSessionView[]>>;
  selectedWorktreeId: string | null;
  setSelectedWorktreeId: Dispatch<SetStateAction<string | null>>;
  setSelectedSessionId: Dispatch<SetStateAction<string | null>>;
  setActiveView: Dispatch<SetStateAction<ActiveView>>;
  persistSelection: (projectId: string | null, sessionId: string | null) => void;
  setPendingAction: Dispatch<SetStateAction<boolean>>;
  setWorktreeForce: Dispatch<SetStateAction<WorktreeForceState | null>>;
  /** Brings the session a new worktree's setup script runs in onto the screen. */
  revealSetupSession(sessionId: string): void;
}

/** 워크트리를 만든 뒤 열고, diff를 보이고, 제거하는(필요하면 강제로) 동작들. */
export function createWorktreeActions(context: WorktreeContext) {
  const {
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
    revealSetupSession,
  } = context;
  const whilePending = pendingRunner(setPendingAction, setActionError);

  const handleWorktreeCreated = ({ worktree, setupSessionId, setupError }: WorktreeCreateResult) => {
    setWorktreeCreateProject(null);
    setWorktrees((current) => [...current, worktree]);
    selectWorktree(worktree);
    if (setupSessionId) revealSetupSession(setupSessionId);
    if (setupError) setActionError(`워크트리는 만들었지만 셋업 스크립트를 시작하지 못했습니다: ${setupError}`);
  };

  /** A removal that did not happen asks its follow-up question: discard changes, or skip teardown. */
  const askAfterRefusal = (worktree: SharedWorktree, result: Exclude<WorktreeRemovalResult, { removed: true }>, force: boolean) => {
    if (result.reason === "dirty") setWorktreeForce({ worktree, reason: "dirty", message: result.message });
    else setWorktreeForce({ worktree, reason: "teardown-failed", message: result.message, output: result.output, force });
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
    await whilePending(async () => {
      const result = await window.multiCliWork.worktrees.remove(worktree.id, false);
      if (result.removed) cleanupRemovedWorktree(worktree);
      else askAfterRefusal(worktree, result, false);
    });
  };

  /** The answer to that question: discard the changes, or remove without the teardown script. */
  const forceWorktreeRemoval = async (state: WorktreeForceState) => {
    setWorktreeForce(null);
    await whilePending(async () => {
      const force = state.reason === "dirty" ? true : state.force;
      const result =
        state.reason === "teardown-failed"
          ? await window.multiCliWork.worktrees.remove(state.worktree.id, force, { skipTeardown: true })
          : await window.multiCliWork.worktrees.remove(state.worktree.id, force);
      if (result.removed) cleanupRemovedWorktree(state.worktree);
      else askAfterRefusal(state.worktree, result, force);
    });
  };

  return {
    handleWorktreeCreated,
    showDiff,
    requestWorktreeRemoval,
    confirmWorktreeRemoval,
    forceWorktreeRemoval,
  };
}
