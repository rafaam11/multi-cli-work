const SYNC_START = "\u001b[?2026h";
const SYNC_END = "\u001b[?2026l";
const CLEAR_SCREEN = "\u001b[2J";

const STATE_SEQUENCES = [SYNC_START, SYNC_END] as const;
const SYNC_SEQUENCES = [...STATE_SEQUENCES, CLEAR_SCREEN] as const;

interface TerminalOutputFilter {
  write(data: string): string;
}

function trailingPrefixLength(input: string, sequences: readonly string[]): number {
  const maximum = Math.min(input.length, Math.max(...sequences.map((sequence) => sequence.length - 1)));
  for (let length = maximum; length > 0; length -= 1) {
    const suffix = input.slice(-length);
    if (sequences.some((sequence) => sequence.startsWith(suffix))) return length;
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
      pending = "";
      const output: string[] = [];
      let cursor = 0;

      while (cursor < input.length) {
        const sequences = inSyncBlock ? SYNC_SEQUENCES : STATE_SEQUENCES;
        let nextIndex = -1;
        let nextSequence = "";

        for (const sequence of sequences) {
          const index = input.indexOf(sequence, cursor);
          if (index !== -1 && (nextIndex === -1 || index < nextIndex)) {
            nextIndex = index;
            nextSequence = sequence;
          }
        }

        if (nextIndex === -1) {
          const remainder = input.slice(cursor);
          const retainedLength = trailingPrefixLength(remainder, sequences);
          output.push(remainder.slice(0, remainder.length - retainedLength));
          pending = remainder.slice(remainder.length - retainedLength);
          break;
        }

        output.push(input.slice(cursor, nextIndex));
        cursor = nextIndex + nextSequence.length;
        if (nextSequence === SYNC_START) {
          inSyncBlock = true;
          output.push(nextSequence);
        } else if (nextSequence === SYNC_END) {
          inSyncBlock = false;
          output.push(nextSequence);
        }
        // ED2 is deliberately omitted only while in a synchronized-output block.
      }

      return output.join("");
    },
  };
}
