import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it } from "vitest";
import { boundReplay, ReplayModeTracker, sizeMarker, splitReplay, stripSizeMarkers } from "./terminal-replay";

const ESC = "\u001b";
const BEL = "\u0007";

const terminals: Terminal[] = [];

function terminalAt(cols: number, rows: number): Terminal {
  const terminal = new Terminal({ cols, rows, allowProposedApi: true });
  terminals.push(terminal);
  return terminal;
}

function written(terminal: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve));
}

/** The order TerminalPane drives a real terminal in; TerminalPane.test.tsx pins that the pane does. */
async function play(terminal: Terminal, replay: string): Promise<void> {
  for (const step of splitReplay(replay)) {
    if (step.type === "data") await written(terminal, step.data);
    else terminal.resize(step.cols, step.rows);
  }
}

function screenLines(terminal: Terminal): string[] {
  const buffer = terminal.buffer.active;
  const lines: string[] = [];
  for (let row = 0; row < terminal.rows; row += 1) {
    // Bounded by cols: the alternate buffer keeps a shrunk line's old cells, which are not on screen.
    lines.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true, 0, terminal.cols) ?? "");
  }
  return lines;
}

afterEach(() => {
  for (const terminal of terminals) terminal.dispose();
  terminals.length = 0;
});

describe("splitReplay", () => {
  it("returns a replay without size records as one step, unchanged", () => {
    const log = `${ESC}[31mold log${ESC}[0m\r\n`;

    expect(splitReplay(log)).toEqual([{ type: "data", data: log }]);
  });

  it("returns nothing for an empty replay", () => {
    expect(splitReplay("")).toEqual([]);
  });

  it("orders each stretch of output after the size it was written at", () => {
    expect(splitReplay(`${sizeMarker(120, 40)}wide${sizeMarker(80, 24)}narrow`)).toEqual([
      { type: "size", cols: 120, rows: 40 },
      { type: "data", data: "wide" },
      { type: "size", cols: 80, rows: 24 },
      { type: "data", data: "narrow" },
    ]);
  });

  it("keeps only the last of consecutive size records", () => {
    expect(splitReplay(`a${sizeMarker(100, 30)}${sizeMarker(90, 20)}${sizeMarker(120, 40)}b`)).toEqual([
      { type: "data", data: "a" },
      { type: "size", cols: 120, rows: 40 },
      { type: "data", data: "b" },
    ]);
  });

  it("removes a size record outside the grid a terminal can take without acting on it", () => {
    for (const forged of [
      `${ESC}]7719;1;24${BEL}`,
      `${ESC}]7719;80;0${BEL}`,
      `${ESC}]7719;99999;99999${BEL}`,
    ]) {
      expect(splitReplay(`a${forged}b`)).toEqual([
        { type: "data", data: "a" },
        { type: "data", data: "b" },
      ]);
    }
  });
});

describe("stripSizeMarkers", () => {
  it("leaves the output and removes only the size records", () => {
    const osc9 = `${ESC}]9;done${BEL}`;

    expect(stripSizeMarkers(`one${sizeMarker(120, 40)}two${osc9}`)).toBe(`one` + `two${osc9}`);
  });
});

describe("sized replay on a real terminal", () => {
  it("draws no size record on screen for a terminal that does not understand it", async () => {
    const terminal = terminalAt(40, 5);

    await written(terminal, `${sizeMarker(120, 40)}visible`);

    expect(screenLines(terminal)[0]).toBe("visible");
    expect(terminal.cols).toBe(40);
  });

  it("rebuilds a full-screen frame painted across a resize the way it looked live", async () => {
    // The second paint only touches row 2: that is what a diffing TUI sends after a resize. Row 1
    // is right only if the terminal was at the old width and then shrank, as the live one did.
    const replay =
      `${sizeMarker(20, 5)}${ESC}[?1049h${ESC}[1;1H${"A".repeat(20)}${ESC}[2;1H${"B".repeat(20)}` +
      `${sizeMarker(10, 5)}${ESC}[2;1H${"C".repeat(10)}`;

    const fixedGrid = terminalAt(30, 5);
    await written(fixedGrid, stripSizeMarkers(replay));
    expect(screenLines(fixedGrid).slice(0, 2)).toEqual(["A".repeat(20), `${"C".repeat(10)}${"B".repeat(10)}`]);

    const sized = terminalAt(30, 5);
    await play(sized, replay);
    expect(screenLines(sized).slice(0, 2)).toEqual(["A".repeat(10), "C".repeat(10)]);
    expect(sized.cols).toBe(10);
  });
});

describe("boundReplay", () => {
  it("returns a plain log's tail untouched", () => {
    expect(boundReplay("older plain text\r\n", "newer plain text")).toBe("newer plain text");
  });

  it("keeps a terminal in the modes the cut-off output had switched on", async () => {
    const dropped = `${ESC}[?1049h${ESC}[?2004h${ESC}[?1004h${"x".repeat(50)}`;

    const terminal = terminalAt(40, 5);
    await written(terminal, boundReplay(dropped, `${ESC}[1;1Hframe`));

    expect(terminal.buffer.active.type).toBe("alternate");
    expect(terminal.modes.bracketedPasteMode).toBe(true);
    expect(terminal.modes.sendFocusMode).toBe(true);
    expect(screenLines(terminal)[0]).toBe("frame");
  });

  it("carries the last size the cut-off output recorded", () => {
    const dropped = `${sizeMarker(100, 30)}old${sizeMarker(120, 40)}older`;

    expect(boundReplay(dropped, "kept")).toBe(`${sizeMarker(120, 40)}kept`);
  });

  it("does not let a size record outside the grid replace the real one", () => {
    expect(boundReplay(`${sizeMarker(120, 40)}${ESC}]7719;1;0${BEL}`, "kept")).toBe(`${sizeMarker(120, 40)}kept`);
  });

  it("does not restore a mode the cut-off output had already switched back off", () => {
    expect(boundReplay(`${ESC}[?1049h${ESC}[?2004h${ESC}[?2004l${ESC}[?1049l`, "kept")).toBe("kept");
  });

  it("restores a hidden cursor, the one tracked mode that defaults to on", () => {
    expect(boundReplay(`${ESC}[?25l`, "kept")).toBe(`${ESC}[?25lkept`);
    expect(boundReplay(`${ESC}[?25l${ESC}[?25h`, "kept")).toBe("kept");
  });

  it("reads every mode of a sequence that sets several at once", () => {
    expect(boundReplay(`${ESC}[?1004;2004h`, "kept")).toBe(`${ESC}[?1004h${ESC}[?2004hkept`);
  });

  it("treats the alternate-screen modes as one switch, as xterm does", () => {
    expect(boundReplay(`${ESC}[?1049h${ESC}[?47l`, "kept")).toBe("kept");
  });

  it("treats the mouse tracking modes as one setting, as xterm does", () => {
    expect(boundReplay(`${ESC}[?1000h${ESC}[?1003h`, "kept")).toBe(`${ESC}[?1003hkept`);
    expect(boundReplay(`${ESC}[?1000h${ESC}[?1003h${ESC}[?1000l`, "kept")).toBe("kept");
  });

  it("forgets the modes a full terminal reset cleared, but not the size", () => {
    expect(boundReplay(`${sizeMarker(120, 40)}${ESC}[?1049h${ESC}c`, "kept")).toBe(`${sizeMarker(120, 40)}kept`);
  });

  it("ignores a mode it does not track", () => {
    expect(boundReplay(`${ESC}[?12h${ESC}[?9001h`, "kept")).toBe("kept");
  });

  it.each([
    ["a CSI cut in its parameters", `text${ESC}[38;5`, "1mkept"],
    ["a CSI cut right after its introducer", `text${ESC}[`, "0mkept"],
    ["an escape cut right after ESC", `text${ESC}`, "[0mkept"],
    ["a BEL-terminated OSC", `text${ESC}]0;tit`, `le${BEL}kept`],
    ["an ST-terminated OSC", `text${ESC}]0;tit`, `le${ESC}\\kept`],
    ["an ST cut in two", `text${ESC}]0;title${ESC}`, "\\kept"],
    ["a charset designation", `text${ESC}(`, "Bkept"],
  ])("starts after the rest of %s", (_name, dropped, kept) => {
    expect(boundReplay(dropped, kept)).toBe("kept");
  });

  it("counts a mode switch that the cut split in two", () => {
    expect(boundReplay(`text${ESC}[?10`, "49hkept")).toBe(`${ESC}[?1049hkept`);
  });

  it("counts a size record that the cut split in two", () => {
    expect(boundReplay(`text${ESC}]7719;120;`, `40${BEL}kept`)).toBe(`${sizeMarker(120, 40)}kept`);
  });

  it("does not skip plain output after a sequence that was complete", () => {
    expect(boundReplay(`${ESC}[0m done `, "plain")).toBe("plain");
  });

  it("gives up rather than swallow output when a string sequence never ends", () => {
    const kept = "a".repeat(5_000);

    expect(boundReplay(`${ESC}]0;`, kept)).toBe(kept);
  });

  it("does not skip past a new sequence that aborts the open one", () => {
    expect(boundReplay(`${ESC}]0;tit`, `${ESC}[31mkept`)).toBe(`${ESC}[31mkept`);
  });
});

describe("ReplayModeTracker", () => {
  it("assembles a mode switch split across the chunks it was dropped in", () => {
    const tracker = new ReplayModeTracker();

    tracker.feed(`old${ESC}`);
    tracker.feed("[?10");
    tracker.feed("49hmore");

    expect(tracker.preamble()).toBe(`${ESC}[?1049h`);
  });

  it("is unaffected by its own preamble being dropped and read back", () => {
    const tracker = new ReplayModeTracker();
    tracker.feed(`${sizeMarker(120, 40)}${ESC}[?1049h${ESC}[?25l`);
    const preamble = tracker.preamble();

    const again = new ReplayModeTracker();
    again.feed(preamble);

    expect(again.preamble()).toBe(preamble);
  });
});
