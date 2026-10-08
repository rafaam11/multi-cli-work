import type { GitChangeEntry, TerminalSessionView } from "@shared/api-types";
import type { FileExplorerTarget } from "@shared/file-explorer-types";
import type { ActivePullRequestReview, PullRequestListItem } from "@shared/github-types";
import type { SharedProject } from "@shared/project-types";
import type { GitWorkspaceView, SharedWorktree } from "@shared/worktree-types";
import type { Dispatch, SetStateAction } from "react";
import type { ConfirmRequest } from "../confirm-dialog";
import type { OpenFileTab } from "../file-tabs";
import { errorMessage } from "../ipc-error";
import { documentPaneId, type DocumentPane } from "../pane-items";
import { documentTargetKey, type OpenDocument } from "./app-model";

export interface DocumentContext {
  setDocuments: Dispatch<SetStateAction<OpenDocument[]>>;
  openPane: (paneId: string) => void;
  dropPaneEverywhere: (paneId: string) => void;
  openFileTabs: readonly OpenFileTab[];
  requestCloseFileTab: (tab: OpenFileTab) => void;
  fileExplorerTarget: FileExplorerTarget | null;
  fileExplorerTargetLabel: string | null;
  fileExplorerOwnerProject: SharedProject | null;
  setSessions: Dispatch<SetStateAction<TerminalSessionView[]>>;
  setWorktrees: Dispatch<SetStateAction<SharedWorktree[]>>;
  setWorkspaceViews: Dispatch<SetStateAction<GitWorkspaceView[]>>;
  setWorktreeWarnings: Dispatch<SetStateAction<Record<string, string>>>;
  setActiveReviews: Dispatch<SetStateAction<ActivePullRequestReview[]>>;
  selectSession: (session: TerminalSessionView) => void;
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  setActionError: Dispatch<SetStateAction<string | null>>;
}

/**
 * 오른쪽 사이드바에서 여는 문서 패인(diff·커밋 그래프·PR)을 열고 닫는 동작과, PR 리뷰 작업 공간을
 * 새로 읽고 정리하는 동작.
 */
export function createDocumentActions(context: DocumentContext) {
  const {
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
  } = context;

  /** Opening a document twice moves the focus to the pane already holding it. */
  const openDocument = (document: OpenDocument) => {
    setDocuments((current) => (current.some((item) => item.id === document.id) ? current : [...current, document]));
    openPane(document.id);
  };

  const closeDocument = (paneId: string) => {
    setDocuments((current) => current.filter((document) => document.id !== paneId));
    dropPaneEverywhere(paneId);
  };

  /**
   * The ✕ on a sidebar document row. Only files can hold unsaved work, so only they get routed
   * through the confirmation; the read-only documents just go.
   */
  const closePane = (pane: DocumentPane) => {
    const fileTab = openFileTabs.find((tab) => documentPaneId("file", tab.id) === pane.id);
    if (fileTab) {
      requestCloseFileTab(fileTab);
      return;
    }
    closeDocument(pane.id);
  };

  const openGitDiff = (change: GitChangeEntry) => {
    if (!fileExplorerTarget) return;
    openDocument({
      id: documentPaneId("diff", `${documentTargetKey(fileExplorerTarget)}:${change.path}`),
      kind: "diff",
      file: {
        target: fileExplorerTarget,
        path: change.path,
        status: change.status,
        ...(change.renamedFrom !== undefined ? { renamedFrom: change.renamedFrom } : {}),
        targetLabel: fileExplorerTargetLabel,
      },
    });
  };
  const openGitGraph = () => {
    if (!fileExplorerTarget) return;
    openDocument({
      id: documentPaneId("graph", documentTargetKey(fileExplorerTarget)),
      kind: "graph",
      target: fileExplorerTarget,
      targetLabel: fileExplorerTargetLabel,
    });
  };
  const openPullRequest = (remoteName: string, item: PullRequestListItem) => {
    if (!fileExplorerOwnerProject) return;
    const owner = fileExplorerOwnerProject;
    openDocument({
      id: documentPaneId("pull-request", `${owner.id}:${remoteName}:${item.number}`),
      kind: "pull-request",
      projectId: owner.id,
      remoteName,
      number: item.number,
      label: `#${item.number} ${item.title}`,
    });
  };
  const refreshReviewWorkspace = async (sessionId?: string) => {
    const [nextSessions, nextWorktrees, nextViews, nextReviews] = await Promise.all([
      window.multiCliWork.terminals.list(), window.multiCliWork.worktrees.list(), window.multiCliWork.worktrees.sync(), window.multiCliWork.github.activeReviews(),
    ]);
    setSessions(nextSessions); setWorktrees(nextWorktrees); setWorkspaceViews(nextViews.workspaces); setWorktreeWarnings(nextViews.warnings); setActiveReviews(nextReviews);
    if (sessionId) { const session = nextSessions.find((item) => item.id === sessionId); if (session) selectSession(session); }
  };
  const finishActiveReview = async (review: ActivePullRequestReview, allowUnverifiedReview = false, discardChanges = false): Promise<void> => {
    try {
      const result = await window.multiCliWork.github.finishReview(review.id, { allowUnverifiedReview, discardChanges });
      if (result.state === "review-unverified" || result.state === "verification-unavailable") {
        if (await confirm({ title: "그래도 정리할까요?", message: result.message, confirmLabel: "정리" })) await finishActiveReview(review, true, discardChanges);
        return;
      }
      if (result.state === "dirty") {
        if (await confirm({ title: "변경을 버리고 강제 제거할까요?", message: result.message, confirmLabel: "강제 제거", danger: true })) await finishActiveReview(review, true, true);
        return;
      }
      await refreshReviewWorkspace();
    } catch (error) { setActionError(errorMessage(error)); }
  };

  return {
    openDocument,
    closeDocument,
    closePane,
    openGitDiff,
    openGitGraph,
    openPullRequest,
    refreshReviewWorkspace,
    finishActiveReview,
  };
}
