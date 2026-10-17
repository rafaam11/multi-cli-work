/**
 * What a person is in the middle of typing into each session — a rough count of the characters
 * sitting unsent in the CLI's input box. The PTY never tells us that, so it is read off the bytes the
 * desktop and the phone write: only those two paths are a human at a keyboard, which is why the
 * control CLI's own writes never pass through here.
 *
 * It is a heuristic and errs toward "still typing": a draft cleared with the mouse or an editor
 * shortcut stays counted until Enter or Ctrl+C — a held message waits a little longer, it is never
 * typed into the middle of someone's sentence. Ctrl+U is deliberately not a reset: Claude Code and
 * Codex clear the line with it, but PowerShell's PSReadLine leaves the draft where it was.
 */

const ESC = 0x1b;

export interface HumanDraft {
  /** Characters believed to be in the input box right now. */
  length: number;
  /** When a person last wrote to the session, in ms; null if never. */
  lastInputAt: number | null;
}

export class HumanInputTracker {
  private readonly drafts = new Map<string, HumanDraft>();
  private readonly listeners = new Set<(sessionId: string) => void>();

  constructor(private readonly now: () => number = Date.now) {}

  note(sessionId: string, data: string): void {
    const draft = this.drafts.get(sessionId) ?? { length: 0, lastInputAt: null };
    let length = draft.length;
    for (let index = 0; index < data.length; index += 1) {
      const code = data.charCodeAt(index);
      if (code === ESC) {
        index = skipEscapeSequence(data, index);
        continue;
      }
      if (code === 0x0d || code === 0x03) length = 0;
      else if (code === 0x7f || code === 0x08) length = Math.max(0, length - 1);
      else if (code >= 0x20 || code === 0x0a || code === 0x09) length += 1;
    }
    this.drafts.set(sessionId, { length, lastInputAt: this.now() });
    for (const listener of this.listeners) listener(sessionId);
  }

  draft(sessionId: string): HumanDraft {
    return this.drafts.get(sessionId) ?? { length: 0, lastInputAt: null };
  }

  forget(sessionId: string): void {
    this.drafts.delete(sessionId);
  }

  onChange(listener: (sessionId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/**
 * Index of the last character of the escape sequence starting at `start`. A bracketed paste's
 * markers are sequences too, so the pasted text between them still counts as typed.
 */
function skipEscapeSequence(data: string, start: number): number {
  const next = data[start + 1];
  if (next === "[") {
    let index = start + 2;
    while (index < data.length) {
      const code = data.charCodeAt(index);
      if (code >= 0x40 && code <= 0x7e) return index;
      index += 1;
    }
    return data.length - 1;
  }
  if (next === "]") {
    // OSC runs to BEL or ST; the phone never sends one, but a paste could carry one.
    let index = start + 2;
    while (index < data.length) {
      if (data.charCodeAt(index) === 0x07) return index;
      if (data[index] === ESC_CHAR && data[index + 1] === "\\") return index + 1;
      index += 1;
    }
    return data.length - 1;
  }
  // Alt+key and SS3 (ESC O x): one more character.
  return next === "O" ? Math.min(start + 2, data.length - 1) : Math.min(start + 1, data.length - 1);
}

const ESC_CHAR = String.fromCharCode(ESC);
