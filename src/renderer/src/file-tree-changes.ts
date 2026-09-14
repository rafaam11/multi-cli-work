import type { FileTreeEntry, WorkspaceChangedPaths } from "@shared/file-explorer-types";

/** "에이전트가 고친 파일" vs "그 외 세션 중 변경" — agent always wins where both would apply. */
export type ChangeOrigin = "agent" | "local";

/**
 * Turns one `changedPaths` read plus whatever directory listings are already loaded into the lookups
 * a row needs. Mirrors `file-tree-git.ts`'s shape: an exact-path map plus an ancestor-folder rollup,
 * so a collapsed folder still shows something changed inside it.
 */
export interface FileTreeChangeOverlay {
  /** Exact relative path → who changed it. */
  originByPath: Map<string, ChangeOrigin>;
  /** Every folder with a change somewhere below it, at any depth. Agent wins on a shared ancestor. */
  changedDirs: Map<string, ChangeOrigin>;
}

export const EMPTY_CHANGE_OVERLAY: FileTreeChangeOverlay = {
  originByPath: new Map(),
  changedDirs: new Map(),
};

/**
 * `local` (non-agent) status only ever comes from directories the tree has already loaded — the tree
 * is lazy and this deliberately does not add polling to change that (see the plan's "알려진 한계").
 * Agent status comes from the main-process edit index instead, so it is not subject to that limit.
 */
export function buildChangeOverlay(
  changed: WorkspaceChangedPaths | null,
  childrenByDir: Record<string, FileTreeEntry[] | "loading" | "error" | undefined>,
): FileTreeChangeOverlay {
  if (!changed) return EMPTY_CHANGE_OVERLAY;
  const originByPath = new Map<string, ChangeOrigin>();
  for (const agentPath of changed.agentPaths) {
    originByPath.set(agentPath.relativePath, "agent");
  }
  for (const entries of Object.values(childrenByDir)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry.kind !== "file" || originByPath.has(entry.relativePath)) continue;
      if (entry.mtimeMs > changed.baselineMs) originByPath.set(entry.relativePath, "local");
    }
  }
  const changedDirs = new Map<string, ChangeOrigin>();
  for (const [relativePath, origin] of originByPath) {
    for (let cut = relativePath.lastIndexOf("/"); cut > 0; cut = relativePath.lastIndexOf("/", cut - 1)) {
      const dir = relativePath.slice(0, cut);
      if (changedDirs.get(dir) === "agent") continue;
      changedDirs.set(dir, origin);
    }
  }
  return { originByPath, changedDirs };
}

const ORIGIN_CLASS: Record<ChangeOrigin, string> = { agent: "change-agent", local: "change-local" };
const BELOW_CLASS: Record<ChangeOrigin, string> = { agent: "change-below-agent", local: "change-below-local" };

/** The class one row gets for its change origin, or null when nothing here changed. */
export function changeRowClass(
  overlay: FileTreeChangeOverlay,
  relativePath: string,
  kind: "file" | "directory",
): string | null {
  const origin = overlay.originByPath.get(relativePath);
  if (origin) return ORIGIN_CLASS[origin];
  if (kind === "directory") {
    const below = overlay.changedDirs.get(relativePath);
    if (below) return BELOW_CLASS[below];
  }
  return null;
}

/** Spelled out in the row's title so the distinction never rides on color alone. */
export function changeOriginLabel(origin: ChangeOrigin): string {
  return origin === "agent" ? "에이전트가 수정함" : "세션 중 수정됨";
}
