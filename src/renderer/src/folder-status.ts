import type { ProjectStatus } from "@shared/project-types";

/**
 * The 폴더 layer's status is the one colour in the sidebar the user sets by hand — session rows keep
 * deriving theirs from the PTY. `SharedProject.status` has carried four values since the registry
 * was written, but the sidebar only ever offers a toggle, so this module reads that field as a
 * binary: 완료, or still being worked on.
 *
 * 보류/보관 stay valid in the registry and simply read as 작업중 here. Nothing in the UI can produce
 * them, and giving them a colour of their own would mean a toggle with no way back.
 *
 * The colours live in index.css keyed by `folderStatusClass`, the same one-place mapping
 * work-project-accent.ts uses for the group rails.
 */
export function isFolderDone(status: ProjectStatus | null): boolean {
  return status === "완료";
}

/** The toggle's round trip, closed: 완료 and 진행중 are the only two values it ever writes. */
export function nextFolderStatus(status: ProjectStatus | null): ProjectStatus {
  return isFolderDone(status) ? "진행중" : "완료";
}

export function folderStatusClass(status: ProjectStatus | null): string {
  return isFolderDone(status) ? "folder-done" : "folder-working";
}
