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
 * Sessions that can take a diff's line notes: alive, and working in that exact checkout — the
 * folder itself (not one of its worktrees) or the one worktree.
 */
export function noteTargets(
  sessions: readonly TerminalSessionView[],
  target: { kind: "project" | "worktree"; id: string },
): TerminalSessionView[] {
  return sessions.filter(
    (session) =>
      session.status !== "exited" &&
      session.status !== "error" &&
      (target.kind === "worktree" ? session.worktreeId === target.id : session.projectId === target.id && !session.worktreeId),
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

/** Pause between a prompt's text and the Enter that submits it. */
export const PROMPT_SUBMIT_GAP_MS = 300;

/**
 * Writes terminal input that ends in a submitting Enter as two writes, the Enter after a pause.
 * Claude takes a long chunk ending in a carriage return for a paste and keeps the return as part of
 * it, so the prompt sits in the box and never goes.
 */
export async function submitTerminalInput(
  write: (data: string) => Promise<unknown>,
  data: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  if (!data.endsWith("\r") || data === "\r") {
    await write(data);
    return;
  }
  await write(data.slice(0, -1));
  await sleep(PROMPT_SUBMIT_GAP_MS);
  await write("\r");
}
