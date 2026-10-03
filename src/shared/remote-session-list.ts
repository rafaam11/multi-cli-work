import type { RemoteServerMessage, RemoteSessionSummary } from "./remote-types";

/**
 * 호스트가 보내는 메시지로 세션 목록을 최신으로 유지한다. 웹 UI의 목록과, 다른 PC의 main이 유지하는
 * 상태 연결이 같이 쓴다. 목록과 무관한 메시지에는 받은 배열을 그대로 돌려준다.
 */
export function applySessionMessage(
  sessions: RemoteSessionSummary[],
  message: RemoteServerMessage,
): RemoteSessionSummary[] {
  switch (message.type) {
    case "sessions":
      return message.sessions;
    case "created":
      // 이미 아는 세션이면 새 상태로 바꾼다 — 다시 시작한 세션은 created로 자기를 알린다.
      return sessions.some((session) => session.id === message.session.id)
        ? sessions.map((session) => (session.id === message.session.id ? message.session : session))
        : [...sessions, message.session];
    case "removed":
      return sessions.filter((session) => session.id !== message.sessionId);
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
