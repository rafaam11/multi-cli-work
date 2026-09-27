/**
 * Turns raw PTY output into text a person can read in an editor: colour and cursor escapes, OSC
 * titles and hyperlinks, and other control bytes go; line breaks stay. It does not replay cursor
 * movement, so a full-screen TUI's redraws come out as the frames it printed — the scrollback as it
 * was written, minus the noise, which is what an export is for.
 */

// CSI: ESC [ params intermediates final — colours, cursor moves, erase, modes.
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
// OSC: ESC ] ... terminated by BEL or ST (ESC \) — titles, hyperlinks, notifications.
const OSC = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g;
// DCS / SOS / PM / APC strings, terminated by ST.
const STRING_SEQUENCES = /\u001b[PX^_][\s\S]*?\u001b\\/g;
// Two-byte escapes (charset selection, keypad modes, save/restore cursor, index, reset).
const SHORT_ESCAPES = /\u001b(?:[()*+][0-9A-Za-z]|[=>78DEHMNOZc])/g;
// Anything else below 0x20 except tab and newline, plus DEL.
const CONTROL_BYTES = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export function stripTerminalControls(output: string): string {
  return output
    .replace(OSC, "")
    .replace(STRING_SEQUENCES, "")
    .replace(CSI, "")
    .replace(SHORT_ESCAPES, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(CONTROL_BYTES, "");
}
