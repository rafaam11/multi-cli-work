const SYNC_START = "\u001b[?2026h";
const SYNC_END = "\u001b[?2026l";
const CLEAR_SCREEN = "\u001b[2J";

const ALL_SEQUENCES = [SYNC_START, SYNC_END, CLEAR_SCREEN] as const;
const CONTROL_SEQUENCE_PATTERN = /\u001b\[\?2026[hl]|\u001b\[2J/g;

interface TerminalOutputFilter {
  write(data: string): string;
}

function trailingPrefixLength(input: string, sequences: readonly string[]): number {
  const maximum = Math.min(input.length, Math.max(...sequences.map((sequence) => sequence.length - 1)));
  for (let length = maximum; length > 0; length -= 1) {
    const suffix = input.slice(-length);
    if (sequences.some((sequence) => sequence.length > suffix.length && sequence.startsWith(suffix))) return length;
  }
  return 0;
}

/**
 * Work around xterm.js#5801 without changing the PTY stream or persisted scrollback. xterm.js 6.0
 * resets its viewport when ED2 is parsed inside a DEC 2026 synchronized-output block, which makes
 * Codex and other full-screen TUIs jump while the user scrolls. The parser retains partial control
 * sequences because node-pty may split one sequence across arbitrary data chunks.
 *
 * Remove this filter after the upstream fix ships in the xterm.js version used by the app:
 * https://github.com/xtermjs/xterm.js/issues/5801
 */
export function createTerminalOutputFilter(): TerminalOutputFilter {
  let inSyncBlock = false;
  let pending = "";

  return {
    write(data: string): string {
      const input = pending + data;
      const retainedLength = trailingPrefixLength(input, ALL_SEQUENCES);
      const complete = input.slice(0, input.length - retainedLength);
      pending = input.slice(input.length - retainedLength);

      return complete.replace(CONTROL_SEQUENCE_PATTERN, (sequence) => {
        if (sequence === SYNC_START) {
          inSyncBlock = true;
          return sequence;
        }
        if (sequence === SYNC_END) {
          inSyncBlock = false;
          return sequence;
        }
        return inSyncBlock ? "" : sequence;
      });
    },
  };
}
