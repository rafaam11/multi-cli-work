import { describe, expect, it } from "vitest";
import { clipboardKeyAction, createReplayGate, encodeComposerInput, QUICK_KEYS } from "./terminal-input";

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

describe("clipboardKeyAction", () => {
  const key = (code: string, modifiers: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
    code,
    key: code,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...modifiers,
  });

  it("copies with Ctrl+C only when something is selected", () => {
    expect(clipboardKeyAction(key("KeyC", { ctrlKey: true }), true)).toBe("copy");
    // 선택이 없으면 Ctrl+C는 인터럽트로 PTY에 간다.
    expect(clipboardKeyAction(key("KeyC", { ctrlKey: true }), false)).toBeNull();
  });

  it("always takes Ctrl+Shift+C as the copy key", () => {
    expect(clipboardKeyAction(key("KeyC", { ctrlKey: true, shiftKey: true }), true)).toBe("copy");
    expect(clipboardKeyAction(key("KeyC", { ctrlKey: true, shiftKey: true }), false)).toBe("swallow");
  });

  it("pastes with Ctrl+V and Ctrl+Shift+V", () => {
    expect(clipboardKeyAction(key("KeyV", { ctrlKey: true }), false)).toBe("paste");
    expect(clipboardKeyAction(key("KeyV", { ctrlKey: true, shiftKey: true }), true)).toBe("paste");
  });

  it("leaves every other key to the terminal", () => {
    expect(clipboardKeyAction(key("KeyC"), true)).toBeNull();
    expect(clipboardKeyAction(key("KeyV", { ctrlKey: true, altKey: true }), false)).toBeNull();
    expect(clipboardKeyAction(key("KeyC", { ctrlKey: true, metaKey: true }), true)).toBeNull();
    expect(clipboardKeyAction(key("KeyX", { ctrlKey: true }), true)).toBeNull();
  });
});
