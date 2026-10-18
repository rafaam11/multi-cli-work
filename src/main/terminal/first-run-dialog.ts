/**
 * Screens a CLI puts up before it reads prompts, which no status hook reports: Claude's folder trust
 * and bypass-permissions warnings, Codex's hook trust and folder approval. Typed text lands on their
 * options — a "2" in a message picks "No, exit" on Claude's — and the Enter that answers one is not a
 * prompt. Matched against the screen with spacing and case dropped, since TUIs draw with cursor
 * moves rather than spaces.
 */
const BLOCKING_DIALOGS = [/yes,?itrustthisfolder/g, /doyoutrustthe(files|contents)/g, /trustallandcontinue/g, /yes,?iaccept/g, /allowcodextowork/g];
/**
 * What the CLIs draw around their prompt box. Seen after a dialog's text, it means the dialog has
 * closed — Codex repaints its hook dialog once more on the way out, after the answering keystroke.
 */
const PROMPT_READY = [/askcodextodoanything/g, /\?forshortcuts/g, /shift\+tabtocycle/g];
const DIALOG_WINDOW = 600;
const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`${ESC}(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^\\u0007]*(?:\\u0007|${ESC}\\\\)|.)`, "g");

/** Where the last match of any pattern ends, or -1. */
function lastMatchEnd(text: string, patterns: readonly RegExp[]): number {
  let end = -1;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) end = Math.max(end, match.index + match[0].length);
  }
  return end;
}

/** Follows each session's screen for a first-run dialog. */
export class FirstRunDialogWatcher {
  private readonly tails = new Map<string, string>();
  private readonly up = new Set<string>();

  observe(sessionId: string, data: string): void {
    const compact = data.replace(ANSI, "").replace(/\s+/g, "").toLowerCase();
    if (!compact) return;
    const tail = `${this.tails.get(sessionId) ?? ""}${compact}`.slice(-DIALOG_WINDOW);
    this.tails.set(sessionId, tail);
    const dialogAt = lastMatchEnd(tail, BLOCKING_DIALOGS);
    const readyAt = lastMatchEnd(tail, PROMPT_READY);
    if (dialogAt > readyAt) this.up.add(sessionId);
    else if (readyAt > dialogAt) this.up.delete(sessionId);
  }

  isUp(sessionId: string): boolean {
    return this.up.has(sessionId);
  }

  /** A person's keystroke is the answer to whatever dialog was up. */
  answered(sessionId: string): void {
    this.up.delete(sessionId);
    this.tails.delete(sessionId);
  }

  forget(sessionId: string): void {
    this.answered(sessionId);
  }
}
