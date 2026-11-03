/**
 * Reattaching replays raw PTY bytes, and those bytes alone do not say what they meant: they do not
 * record the width they were written at, and once the front is cut off they no longer contain the
 * switches into the modes that the rest assumes. This module keeps that information with the bytes.
 */

export type ReplayStep =
  | { type: "data"; data: string }
  | { type: "size"; cols: number; rows: number };

/** A private OSC. Consumers split it out before parsing; older terminals ignore it. */
export function sizeMarker(cols: number, rows: number): string {
  return `\u001b]7719;${cols};${rows}\u0007`;
}

const SIZE_MARKER = /\u001b\]7719;(\d{1,5});(\d{1,5})\u0007/g;

/** A program can print a size record of its own, so what it says is not taken on trust. */
function isTerminalSize(cols: number, rows: number): boolean {
  return cols >= 2 && cols <= 2000 && rows >= 1 && rows <= 1000;
}

export function splitReplay(replay: string): ReplayStep[] {
  const steps: ReplayStep[] = [];
  let start = 0;
  for (const match of replay.matchAll(SIZE_MARKER)) {
    if (match.index > start) steps.push({ type: "data", data: replay.slice(start, match.index) });
    start = match.index + match[0].length;
    const cols = Number(match[1]);
    const rows = Number(match[2]);
    if (!isTerminalSize(cols, rows)) continue;
    if (steps[steps.length - 1]?.type === "size") steps.pop();
    steps.push({ type: "size", cols, rows });
  }
  if (start < replay.length) steps.push({ type: "data", data: replay.slice(start) });
  return steps;
}

export function stripSizeMarkers(text: string): string {
  return text.replace(SIZE_MARKER, "");
}

/** A caller without a visible pane can still resume at the last recorded PTY dimensions. */
export function lastReplaySize(replay: string): { cols: number; rows: number } | undefined {
  let size: { cols: number; rows: number } | undefined;
  for (const match of replay.matchAll(SIZE_MARKER)) {
    const cols = Number(match[1]);
    const rows = Number(match[2]);
    if (isTerminalSize(cols, rows)) size = { cols, rows };
  }
  return size;
}

const CURSOR_VISIBLE_MODE = 25;

/** xterm keeps one setting per group: the last `h` wins, and an `l` of any member turns the group off. */
const MODE_GROUPS: ReadonlyArray<readonly number[]> = [
  [1],
  [47, 1047, 1049],
  [1000, 1002, 1003],
  [1005, 1006, 1015],
  [1004],
  [2004],
  [2031],
];

const TRACKED = /\u001b#[3456]|\u001bc|\u001b\[\?([\d;]*)([hl])|\u001b\]7719;(\d{1,5});(\d{1,5})\u0007/g;

/** A whole control sequence at the start of the text: CSI, a string sequence, or a plain escape. */
const SEQUENCE_AT_START =
  /^\u001b(?:\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|[\]PX^_][^\u0007\u001b]*(?:\u0007|\u001b\\|(?=\u001b))|[\x20-\x2f]*[\x30-\x4f\x51-\x57\x59-\x5a\x5c\x60-\x7e])/;

/** Past this, a sequence that has not ended is taken not to be one, so a stray ESC cannot eat output. */
const MAX_OPEN_SEQUENCE = 4096;

/** Reads output that is being thrown away, to remember what the output after it depends on. */
export class ReplayModeTracker {
  private readonly activeModes = new Map<readonly number[], number>();
  private cursorHidden = false;
  private size: { cols: number; rows: number } | null = null;
  /** The sequence the input ends in the middle of. */
  private open = "";
  private standardWidth = true;

  columns(): number | undefined { return this.size?.cols; }
  canCompact(): boolean { return this.standardWidth; }

  feed(data: string): void {
    const text = this.open + data;
    for (const match of text.matchAll(TRACKED)) {
      if (match[0].startsWith("\u001b#")) this.standardWidth = false;
      else if (match[0] === "\u001bc") this.resetModes();
      else if (match[2]) this.setModes(match[1], match[2] === "h");
      else this.setSize(Number(match[3]), Number(match[4]));
    }
    const lastEscape = text.lastIndexOf("\u001b");
    const candidate = lastEscape < 0 ? "" : text.slice(lastEscape);
    this.open = candidate.length <= MAX_OPEN_SEQUENCE && !SEQUENCE_AT_START.test(candidate) ? candidate : "";
  }

  /**
   * Takes the rest of a sequence the cut went through off the front of what is kept, counting it. If
   * no end is in reach the text stays: showing a fragment is better than swallowing real output.
   */
  consumeOpenSequence(kept: string): string {
    if (!this.open) return kept;
    const match = SEQUENCE_AT_START.exec(this.open + kept.slice(0, MAX_OPEN_SEQUENCE));
    if (!match) return kept;
    const remainder = match[0].length - this.open.length;
    this.feed(kept.slice(0, remainder));
    this.open = "";
    return kept.slice(remainder);
  }

  /** What to put in front of the kept output. Empty unless the dropped output changed something. */
  preamble(): string {
    let preamble = this.size ? sizeMarker(this.size.cols, this.size.rows) : "";
    for (const group of MODE_GROUPS) {
      const mode = this.activeModes.get(group);
      if (mode !== undefined) preamble += `\u001b[?${mode}h`;
    }
    if (this.cursorHidden) preamble += `\u001b[?${CURSOR_VISIBLE_MODE}l`;
    return preamble;
  }

  private setModes(params: string, on: boolean): void {
    for (const param of params.split(";")) {
      const mode = Number(param);
      if (mode === 69 && on) this.standardWidth = false;
      if (mode === CURSOR_VISIBLE_MODE) {
        this.cursorHidden = !on;
        continue;
      }
      const group = MODE_GROUPS.find((members) => members.includes(mode));
      if (!group) continue;
      if (on) this.activeModes.set(group, mode);
      else this.activeModes.delete(group);
    }
  }

  private setSize(cols: number, rows: number): void {
    if (isTerminalSize(cols, rows)) this.size = { cols, rows };
  }

  /** A full reset (RIS) clears the modes; it does not change how big the window is. */
  private resetModes(): void {
    this.standardWidth = true;
    this.activeModes.clear();
    this.cursorHidden = false;
  }
}

/** The same boundary for a cut made all at once. */
export function boundReplay(dropped: string, kept: string): string {
  const tracker = new ReplayModeTracker();
  tracker.feed(dropped);
  const rest = tracker.consumeOpenSequence(kept);
  return tracker.preamble() + rest;
}
