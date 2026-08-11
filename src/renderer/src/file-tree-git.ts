import type { GitChangeStatus, GitPanelData } from "@shared/api-types";

/**
 * Turns one git panel read into the lookups the file tree needs per row. Git reports changes as a
 * flat list of file paths; a tree also has to answer "does this folder hold a change" and "is this
 * path inside an ignored folder", so both are precomputed once instead of scanned per row.
 */
export interface FileTreeGitOverlay {
  /** Exact repo-relative path → the status git reported for it. */
  statusByPath: Map<string, GitChangeStatus>;
  /** Every folder with a change somewhere below it, at any depth. */
  changedDirs: Set<string>;
  /** Ignored roots, without a trailing slash. */
  ignored: string[];
}

export const EMPTY_GIT_OVERLAY: FileTreeGitOverlay = {
  statusByPath: new Map(),
  changedDirs: new Set(),
  ignored: [],
};

/** A folder that is not a repository simply gets no marks. */
export function buildGitOverlay(data: GitPanelData | null): FileTreeGitOverlay {
  if (!data?.isRepo) return EMPTY_GIT_OVERLAY;
  const statusByPath = new Map<string, GitChangeStatus>();
  const changedDirs = new Set<string>();
  for (const change of data.changes) {
    statusByPath.set(change.path, change.status);
    for (let cut = change.path.lastIndexOf("/"); cut > 0; cut = change.path.lastIndexOf("/", cut - 1)) {
      changedDirs.add(change.path.slice(0, cut));
    }
  }
  return { statusByPath, changedDirs, ignored: data.ignored };
}

const STATUS_CLASS: Record<GitChangeStatus, string> = {
  M: "git-modified",
  A: "git-added",
  R: "git-modified",
  D: "git-deleted",
  U: "git-conflict",
  "?": "git-untracked",
};

/**
 * The class one row gets, or null when git has nothing to say about it. Ignored wins: a path under
 * an ignored folder is dim whatever else it looks like.
 */
export function gitRowClass(
  overlay: FileTreeGitOverlay,
  relativePath: string,
  kind: "file" | "directory",
): string | null {
  if (overlay.ignored.some((root) => relativePath === root || relativePath.startsWith(`${root}/`))) {
    return "git-ignored";
  }
  const status = overlay.statusByPath.get(relativePath);
  if (status) return STATUS_CLASS[status];
  // An untracked folder never appears in `changes` itself — only the files under it do.
  if (kind === "directory" && overlay.changedDirs.has(relativePath)) return "git-dirty";
  return null;
}
