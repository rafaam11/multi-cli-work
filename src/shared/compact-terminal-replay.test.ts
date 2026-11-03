import { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { compactTerminalReplay } from "./compact-terminal-replay";
import { sizeMarker, splitReplay } from "./terminal-replay";
import { OutputRingBuffer } from "../main/terminal/terminal-session-manager";

const erase = "\r\x1b[2K";
async function snapshot(data: string) {
  const terminal = new Terminal({ cols: 40, rows: 5, allowProposedApi: true });
  try {
    for (const step of splitReplay(data)) {
      if (step.type === "size") terminal.resize(step.cols, step.rows);
      else await new Promise<void>(resolve => terminal.write(step.data, resolve));
    }
    return { x: terminal.buffer.active.cursorX, y: terminal.buffer.active.cursorY,
      lines: Array.from({ length: terminal.buffer.active.length }, (_, row) => {
        const line = terminal.buffer.active.getLine(row)!;
        return { text: line.translateToString(true), cells: Array.from({ length: terminal.cols }, (_, col) => {
          const cell = line.getCell(col)!;
          return [cell.getChars(), cell.getFgColor(), cell.getBgColor(), cell.isBold(), cell.isUnderline()];
        }) };
      }) };
  } finally { terminal.dispose(); }
}

describe("compactTerminalReplay", () => {
  it("retains the conversation while collapsing repeated spinner lines, preserving terminal cells and SGR", async () => {
    const replay = sizeMarker(40, 5) + "conversation\r\n" + erase + "\x1b[31mold" + erase + "\x1b[1mnew" +
      erase + "\x1b[0m\x1b[32m\x1b[44mlast" + erase + "final";
    const compact = compactTerminalReplay(replay);
    expect(compact.length).toBeLessThan(replay.length);
    expect(compact).toContain("conversation");
    expect(compact).not.toContain("old");
    expect(await snapshot(compact)).toEqual(await snapshot(replay));
  });

  it("compacts full replacements at the same absolute row", async () => {
    const replay = sizeMarker(40, 5) + "header\r\n" + "\x1b[2;1H\x1b[Kone\x1b[2;1H\x1b[Ktwo";
    expect(compactTerminalReplay(replay)).not.toContain("one");
    expect(await snapshot(compactTerminalReplay(replay))).toEqual(await snapshot(replay));
  });

  it.each([
    "no size" + erase + "old" + erase + "new",
    sizeMarker(10, 5) + erase + "this line wraps" + erase + "new",
    sizeMarker(40, 5) + erase + "one\r\n" + erase + "two",
    sizeMarker(40, 5) + "\x1b]0;" + erase + "one" + erase + "two\x07",
    sizeMarker(40, 5) + erase + "one\x1b[?1049h" + erase + "two",
    sizeMarker(40, 5) + erase + "one\x1b[2;1H\x1b[Ktwo",
    sizeMarker(40, 5) + "\x1b#6" + erase + "one" + erase + "two",
    sizeMarker(40, 5) + "\x1b[?69h" + erase + "one" + erase + "two",
  ])("leaves output outside safe adjacent replacements untouched", replay => {
    expect(compactTerminalReplay(replay)).toBe(replay);
  });

  it("rescues old conversation text from the ring before transient output evicts it", () => {
    const ring = new OutputRingBuffer(1024);
    ring.append(sizeMarker(40, 5) + "KEEP_CONVERSATION\r\n");
    for (let i = 0; i < 1000; i++) ring.append(erase + `spin ${i}`);
    expect(ring.toString()).toContain("KEEP_CONVERSATION");
    expect(ring.toString()).toContain("spin 999");
    expect(Buffer.byteLength(ring.toString())).toBeLessThanOrEqual(1024);
  });
});
