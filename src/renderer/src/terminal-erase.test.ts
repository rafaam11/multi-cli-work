import { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";

const write = (terminal: Terminal, data: string) => new Promise<void>(resolve => terminal.write(data, resolve));

describe("native erase-display behavior", () => {
  it("preserves scrollback and the reader's viewport while honoring an ED2 inside synchronized output", async () => {
    const terminal = new Terminal({ cols: 30, rows: 5, scrollOnEraseInDisplay: true, allowProposedApi: true });
    try {
      await write(terminal, Array.from({ length: 20 }, (_, i) => `history ${i}\r\n`).join("") + "old visible frame");
      terminal.scrollToTop();
      const top = terminal.buffer.active.viewportY;
      const first = terminal.buffer.active.getLine(0)?.translateToString(true);
      await write(terminal, "\x1b[?2026h\x1b[2J\x1b[Hnew frame\x1b[?2026l");
      expect(terminal.buffer.active.viewportY).toBe(top);
      expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(first);
      const screen = Array.from({ length: 5 }, (_, row) => terminal.buffer.active.getLine(terminal.buffer.active.baseY + row)?.translateToString(true));
      expect(screen).toEqual(["new frame", "", "", "", ""]);
    } finally { terminal.dispose(); }
  });
});
