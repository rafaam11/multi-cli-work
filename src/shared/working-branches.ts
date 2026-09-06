import type { GitWorkspaceView, SharedWorktree } from "./worktree-types";

/** Known bot/maintenance refs, not broad human workflow names like chore/* or release/*. */
const AUTOMATION_BRANCH_PATTERNS = [
  /^(dependabot|renovate|greenkeeper|depfu|imgbot|changeset-release|gh-readonly-queue)\//,
  /^snyk-(fix|upgrade|patch)-/,
  /^release-please--/,
];

/** Accept canonical branch names or full refs; callers with short remote refs strip the remote. */
export function isWorkingBranch(branch: string | null | undefined): boolean {
  if (!branch) return true; // Detached work is still work.
  const name = branch.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\/[^/]+\//, "");
  return !AUTOMATION_BRANCH_PATTERNS.some((pattern) => pattern.test(name));
}

export function isWorkingWorktree(worktree: SharedWorktree, views: readonly GitWorkspaceView[]): boolean {
  const view = views.find((candidate) => candidate.worktreeId === worktree.id);
  return isWorkingBranch(view ? view.branch : worktree.branch);
}
