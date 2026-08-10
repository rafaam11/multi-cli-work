import type { TerminalStatus } from "@shared/terminal-types";

/**
 * A folder's colour is derived, not declared. The hand-set 완료 toggle went away in v1.14.0: it
 * asked the user to keep a second, manual record of something the sessions already say out loud,
 * and it drifted the moment they forgot to flip it back.
 *
 * Amber means an agent is actually running in that folder right now — starting up, working, or
 * stopped to ask something. Everything else, including a folder with no sessions at all, is green.
 * `SharedProject.status` still lives in the registry for the work-project layer; the sidebar simply
 * stopped reading it.
 *
 * The colours live in index.css keyed by `folderActivityClass`, the same one-place mapping
 * work-project-accent.ts uses for the group rails.
 */
const ACTIVE_STATUSES: ReadonlySet<TerminalStatus> = new Set<TerminalStatus>([
  "starting",
  "working",
  "awaiting-input",
  "awaiting-approval",
]);

/** True while at least one of the folder's sessions has an agent doing something. */
export function isFolderActive(sessions: readonly { status: TerminalStatus }[]): boolean {
  return sessions.some((session) => ACTIVE_STATUSES.has(session.status));
}

export function folderActivityClass(sessions: readonly { status: TerminalStatus }[]): string {
  return isFolderActive(sessions) ? "folder-active" : "folder-idle";
}
