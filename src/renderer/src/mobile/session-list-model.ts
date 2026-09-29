import type { RemoteServerMessage, RemoteSessionSummary } from "@shared/remote-types";

const NO_FOLDER = "폴더 없음";

export function applySessionMessage(
  sessions: RemoteSessionSummary[],
  message: RemoteServerMessage,
): RemoteSessionSummary[] {
  switch (message.type) {
    case "sessions":
      return message.sessions;
    case "created":
      return sessions.some((session) => session.id === message.session.id) ? sessions : [...sessions, message.session];
    case "status":
      return sessions.map((session) => (session.id === message.sessionId ? { ...session, status: message.status } : session));
    case "title":
      return sessions.map((session) => (session.id === message.sessionId ? { ...session, label: message.title } : session));
    case "exit":
      return sessions.map((session) => (session.id === message.sessionId ? { ...session, status: "exited" } : session));
    default:
      return sessions;
  }
}

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
