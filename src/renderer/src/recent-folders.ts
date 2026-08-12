import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";

/** How many folders a launcher offers before the list stops being a shortcut. */
export const RECENT_FOLDER_LIMIT = 5;

/**
 * When this folder was last worked in. A folder's sessions carry that answer — the newest
 * `updatedAt` among them — and one that has never held a session falls back to when it was added,
 * so a folder just opened still sorts above ones abandoned months ago.
 */
function projectActivityTimestamp(project: SharedProject, sessions: TerminalSessionView[]): string {
  const projectSessions = sessions.filter((session) => session.projectId === project.id);
  if (projectSessions.length === 0) return project.createdAt;
  return projectSessions.reduce(
    (latest, session) => (session.updatedAt > latest ? session.updatedAt : latest),
    projectSessions[0].updatedAt,
  );
}

/**
 * The folders worth offering as a starting point, most recently worked in first. The home
 * dashboard's 빠른 실행 and the empty slot's launcher both ask this question, and two screens that
 * disagreed on what "recent" means would be two different shortcuts wearing the same name.
 */
export function recentProjects(
  projects: SharedProject[],
  sessions: TerminalSessionView[],
  limit: number = RECENT_FOLDER_LIMIT,
): SharedProject[] {
  return [...projects]
    .sort((left, right) =>
      projectActivityTimestamp(right, sessions).localeCompare(projectActivityTimestamp(left, sessions)),
    )
    .slice(0, limit);
}
