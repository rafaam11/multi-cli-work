import type { TerminalSessionView } from "@shared/api-types";
import type { BoardMessage, BoardRecipient } from "@shared/board-types";

/** Adds a new message, or swaps in a newer copy of one already shown, keeping the feed in time order. */
export function mergeBoardMessage(messages: readonly BoardMessage[], message: BoardMessage): BoardMessage[] {
  const index = messages.findIndex((existing) => existing.id === message.id);
  if (index >= 0) {
    const next = [...messages];
    next[index] = message;
    return next;
  }
  const next = [...messages, message];
  // Messages almost always arrive in order; only sort when one did not.
  if (messages.length > 0 && messages[messages.length - 1].createdAt > message.createdAt) {
    next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  return next;
}

export function boardRelativeTime(iso: string, now: number): string {
  const elapsed = Math.max(0, now - Date.parse(iso));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const date = new Date(iso);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

/** The sessions that make up a folder's team: everything still running in it, oldest first. */
export function boardMembers(sessions: readonly TerminalSessionView[], projectId: string | null): TerminalSessionView[] {
  if (projectId === null) return [];
  return sessions.filter(
    (session) => session.projectId === projectId && session.tool === null && session.status !== "exited" && session.status !== "error",
  );
}

export function memberName(session: Pick<TerminalSessionView, "id" | "name" | "title" | "kind">): string {
  return session.name?.trim() || session.title?.trim() || `${session.kind}-${session.id.slice(0, 4)}`;
}

/** The `@query` the caret sits at the end of, if any — what the mention picker filters by. */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  return { start: caret - match[2].length - 1, query: match[2] };
}

/** The mentioned sessions whose `@name` is still in the text — deleting the name drops the mention. */
export function activeMentions(text: string, mentions: ReadonlyMap<string, string>): string[] {
  return [...mentions].filter(([, name]) => text.includes(`@${name}`)).map(([sessionId]) => sessionId);
}

export function deliveryLabel(recipient: BoardRecipient): string {
  switch (recipient.delivery) {
    case "delivered":
      return "전달됨";
    case "failed":
      return recipient.reason ? `실패: ${recipient.reason}` : "실패";
    case "dropped":
      return "취소됨";
    case "held":
      return `보류: ${holdReasonLabel(recipient.reason ?? null)}`;
    default:
      return "";
  }
}

export function holdReasonLabel(reason: string | null): string {
  switch (reason) {
    case "working":
      return "작업이 끝나면 전달";
    case "awaiting-approval":
      return "승인을 기다리는 중";
    case "typing":
      return "사람이 입력 중";
    case "starting":
      return "시작하는 중";
    case "settling":
      return "화면이 멈추면 전달";
    case "dialog":
      return "확인 창에 사람이 답하면 전달";
    default:
      return "차례를 기다리는 중";
  }
}

/** Splits text on ``` fences: odd parts are code, shown as a block. */
export function boardTextParts(text: string): Array<{ code: boolean; text: string }> {
  return text
    .split("```")
    .map((part, index) => ({ code: index % 2 === 1, text: index % 2 === 1 ? part.replace(/^[^\n]*\n/, "") : part }))
    .filter((part) => part.text.trim().length > 0);
}

/** Posts from the same author within a few minutes read as one turn; only the first carries the header. */
export function continuesTurn(previous: BoardMessage | undefined, message: BoardMessage): boolean {
  if (!previous || previous.kind !== "post" || message.kind !== "post") return false;
  if (authorKey(previous) !== authorKey(message)) return false;
  return Date.parse(message.createdAt) - Date.parse(previous.createdAt) < 3 * 60_000;
}

function authorKey(message: BoardMessage): string {
  return message.author.kind === "session" ? `s:${message.author.sessionId}` : message.author.kind;
}
