import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { SharedWorktree } from "@shared/worktree-types";
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
  } = context;
  const whilePending = pendingRunner(setPendingAction, setActionError);

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
    await whilePending(async () => {
      const result = await window.multiCliWork.worktrees.remove(worktree.id, false);
      if (result.removed) cleanupRemovedWorktree(worktree);
      else setWorktreeForce({ worktree, message: result.message });
    });
  };

  const forceWorktreeRemoval = async (worktree: SharedWorktree) => {
    setWorktreeForce(null);
    await whilePending(async () => {
      const result = await window.multiCliWork.worktrees.remove(worktree.id, true);
      if (result.removed) cleanupRemovedWorktree(worktree);
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
