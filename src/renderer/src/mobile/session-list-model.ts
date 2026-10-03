import type { RemoteSessionSummary } from "@shared/remote-types";

export { applySessionMessage } from "@shared/remote-session-list";

const NO_FOLDER = "폴더 없음";

export function groupSessions(sessions: RemoteSessionSummary[]) {
  const groups = new Map<string, RemoteSessionSummary[]>();
  for (const session of sessions) {
    const key = session.projectName ?? NO_FOLDER;
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === NO_FOLDER ? 1 : b === NO_FOLDER ? -1 : a.localeCompare(b, "ko")))
    .map(([projectName, entries]) => ({
      projectName,
      sessions: [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    }));
}
