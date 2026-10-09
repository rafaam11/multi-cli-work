import type { SessionProgress } from "../../shared/terminal-types";

const PREFIX = "\u001b]9;4;";
/** A progress sequence is a handful of bytes; anything longer without a terminator is not one. */
const MAX_CARRY = 64;

/** One update: a progress to show, or null to clear it. */
export type ProgressUpdate = SessionProgress | null;

export interface OscProgressScanner {
  scan(chunk: string): ProgressUpdate[];
}

/**
 * Reads ConEmu `OSC 9;4;<state>;<value>` progress reports out of a session's output. A PTY chunk
 * can end anywhere, so a sequence cut in two is carried into the next call — bounded, so a stray
 * prefix cannot make the scanner hold on to output.
 */
export function createOscProgressScanner(): OscProgressScanner {
  let carry = "";
  return {
    scan(chunk) {
      const text = carry + chunk;
      carry = "";
      const updates: ProgressUpdate[] = [];
      let index = 0;
      for (;;) {
        const start = text.indexOf(PREFIX, index);
        if (start === -1) break;
        const bodyStart = start + PREFIX.length;
        const bel = text.indexOf("\u0007", bodyStart);
        const st = text.indexOf("\u001b\\", bodyStart);
        const end = bel !== -1 && (st === -1 || bel < st) ? bel : st;
        if (end === -1) {
          const pending = text.slice(start);
          if (pending.length <= MAX_CARRY) carry = pending;
          return updates;
        }
        const body = text.slice(bodyStart, end);
        const update = body.includes("\u001b") ? undefined : parseProgress(body);
        if (update !== undefined) updates.push(update);
        index = end + (end === bel ? 1 : 2);
      }
      for (let length = Math.min(PREFIX.length - 1, text.length); length > 0; length -= 1) {
        if (text.endsWith(PREFIX.slice(0, length))) {
          carry = PREFIX.slice(0, length);
          break;
        }
      }
      return updates;
    },
  };
}

/** `undefined` for anything that is not a progress report this scanner understands. */
function parseProgress(body: string): ProgressUpdate | undefined {
  const [state, raw] = body.split(";");
  const parsed = raw === undefined || raw.trim() === "" ? null : Number(raw);
  if (parsed !== null && !Number.isFinite(parsed)) return undefined;
  const value = parsed === null ? null : Math.min(100, Math.max(0, Math.round(parsed)));
  switch (state) {
    case "0":
      return null;
    case "1":
      return { state: "normal", value: value ?? 0 };
    case "2":
      return { state: "error", value };
    case "3":
      return { state: "indeterminate", value: null };
    case "4":
      return { state: "warning", value };
    default:
      return undefined;
  }
}
