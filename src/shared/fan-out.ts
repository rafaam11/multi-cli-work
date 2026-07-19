import type { TerminalSessionView } from "./api-types";

const ESC = String.fromCharCode(27);
const BRACKETED_PASTE_START = `${ESC}[200~`;
const BRACKETED_PASTE_END = `${ESC}[201~`;

/** Only sessions that can still read input are offered as fan-out targets. */
export function fanOutTargets(sessions: readonly TerminalSessionView[], projectId: string): TerminalSessionView[] {
  return sessions.filter(
    (session) => session.projectId === projectId && session.status !== "exited" && session.status !== "error",
  );
}

/**
 * A multiline prompt travels as one bracketed paste, so its inner newlines insert instead of firing
 * the prompt early; the trailing carriage return submits. Claude, Codex and PSReadLine all speak
 * bracketed paste. A single line needs none of that.
 */
export function promptAsTerminalInput(prompt: string): string {
  const normalized = prompt.replace(/\r\n?/g, "\n");
  if (!normalized.includes("\n")) return `${normalized}\r`;
  return `${BRACKETED_PASTE_START}${normalized}${BRACKETED_PASTE_END}\r`;
}
