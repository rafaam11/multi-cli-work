import { describe, expect, it } from "vitest";
import { createReplayGate, encodeComposerInput, QUICK_KEYS } from "./terminal-input";

describe("encodeComposerInput", () => {
  it("sends a single line followed by Enter", () => {
    expect(encodeComposerInput("hello")).toBe("hello\r");
  });
  it("wraps multi-line text in bracketed paste, then presses Enter", () => {
    expect(encodeComposerInput("a\r\nb\nc")).toBe("\x1b[200~a\rb\rc\x1b[201~\r");
  });
  it("an empty composer is just Enter", () => {
    expect(encodeComposerInput("")).toBe("\r");
  });
});

describe("QUICK_KEYS", () => {
  it("covers the approval keys", () => {
    expect(QUICK_KEYS.map((key) => key.label)).toEqual(["Esc", "Tab", "↑", "↓", "Enter", "^C", "1", "2", "3", "/"]);
    expect(QUICK_KEYS.find((key) => key.label === "^C")!.data).toBe("\x03");
  });
});

describe("createReplayGate", () => {
  it("buffers output until the replay lands and drops what the replay already holds", () => {
    const written: string[] = [];
    const gate = createReplayGate((data) => written.push(data));
    gate.data("old", 4);
    gate.data("new", 6);
    gate.attached("REPLAY", 5);
    gate.data("next", 7);
    gate.data("dup", 7);
    expect(written).toEqual(["REPLAY", "new", "next"]);
  });

  it("starts over after reset (reconnect)", () => {
    const written: string[] = [];
    const gate = createReplayGate((data) => written.push(data));
    gate.attached("A", 1);
    gate.reset();
    gate.data("while-away", 9);
    gate.attached("B", 8);
    expect(written).toEqual(["A", "B", "while-away"]);
  });
});
