import { describe, expect, it } from "vitest";
import { isWorkingBranch, isWorkingWorktree } from "./working-branches";
import type { GitWorkspaceView, SharedWorktree } from "./worktree-types";

describe("working branch classification", () => {
  it("uses the live checkout rather than a stale registry name, including detached work", () => {
    const tree = { id: "wt", branch: "dependabot/pkg" } as SharedWorktree;
    const view = { worktreeId: "wt", branch: "feature/real" } as GitWorkspaceView;
    expect(isWorkingWorktree(tree, [view])).toBe(true);
    expect(isWorkingWorktree(tree, [{ ...view, branch: null }])).toBe(true);
    expect(isWorkingWorktree({ ...tree, branch: "feature/old" }, [{ ...view, branch: "renovate/pkg" }])).toBe(false);
  });
  it.each(["dependabot/npm/foo", "renovate/pkg", "greenkeeper/pkg", "depfu/pkg", "imgbot/update", "changeset-release/main", "gh-readonly-queue/main/pr-1", "snyk-fix-123", "snyk-upgrade-123", "snyk-patch-123", "release-please--branches--main", "refs/heads/dependabot/pkg", "refs/remotes/company/renovate/pkg"])("excludes automation ref %s", (name) => {
    expect(isWorkingBranch(name)).toBe(false);
  });
  it.each([null, undefined, "main", "master", "develop", "feat/login", "fix/renovate-config", "chore/dependencies", "release/next", "feature/dependabot/ui", "mybot/work", "renovated/ui", "detached"])("preserves working ref %s", (name) => {
    expect(isWorkingBranch(name)).toBe(true);
  });
});
