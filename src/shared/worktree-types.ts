/**
 * A git worktree the app created for a project, so several agents can work the same repo in
 * parallel without stepping on each other. Lives in its own file (`~/.multi-cli-work/worktrees.json`)
 * rather than as a field on `projects.json`: the project registry's exact-keys parser makes any new
 * field there break downgrades. See docs/superpowers/specs/registry-contract.md §8.
 */
export interface SharedWorktree {
  id: string;
  projectId: string;
  /** Absolute path of the worktree directory — the cwd its sessions run in. */
  path: string;
  branch: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorktreeRegistryV1 {
  schemaVersion: 1;
  updatedAt: string;
  worktrees: Record<string, SharedWorktree>;
}

/**
 * Removing a dirty worktree is refused rather than thrown: the renderer turns the refusal into a
 * second, explicit "discard and force" confirmation instead of parsing error messages.
 */
export type WorktreeRemovalResult = { removed: true } | { removed: false; reason: "dirty"; message: string };
