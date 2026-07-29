import { describe, expect, it } from "vitest";
import { createTerminalOutputFilter } from "./terminal-output-filter";

const SYNC_START = "\u001b[?2026h";
const SYNC_END = "\u001b[?2026l";
const CLEAR_SCREEN = "\u001b[2J";

describe("terminal output filter", () => {
  it("removes a clear-screen command only inside synchronized output", () => {
    const filter = createTerminalOutputFilter();

    expect(filter.write(`before${SYNC_START}${CLEAR_SCREEN}frame${SYNC_END}after`)).toBe(
      `before${SYNC_START}frame${SYNC_END}after`,
    );
  });

  it("preserves ordinary clear-screen commands and unrelated control sequences", () => {
    const filter = createTerminalOutputFilter();
    const output = `before${CLEAR_SCREEN}\u001b[3J\u001b]9;agent-turn-complete\u0007after`;

    expect(filter.write(output)).toBe(output);
  });

  it("tracks synchronized output and clear commands across arbitrary chunk boundaries", () => {
    const filter = createTerminalOutputFilter();
    const input = `before${SYNC_START}${CLEAR_SCREEN}frame${SYNC_END}${CLEAR_SCREEN}after`;
    const output = [...input].map((character) => filter.write(character)).join("");

    expect(output).toBe(`before${SYNC_START}frame${SYNC_END}${CLEAR_SCREEN}after`);
  });

  it("preserves incomplete lookalike sequences once they stop matching", () => {
    const filter = createTerminalOutputFilter();

    expect(filter.write("prefix\u001b[?202")).toBe("prefix");
    expect(filter.write("5htext")).toBe("\u001b[?2025htext");
  });

  it("handles repeated synchronized output blocks without leaking state", () => {
    const filter = createTerminalOutputFilter();
    const first = `${SYNC_START}one${CLEAR_SCREEN}${SYNC_END}`;
    const second = `${SYNC_START}${CLEAR_SCREEN}two${SYNC_END}`;

    expect(filter.write(first)).toBe(`${SYNC_START}one${SYNC_END}`);
    expect(filter.write(CLEAR_SCREEN)).toBe(CLEAR_SCREEN);
    expect(filter.write(second)).toBe(`${SYNC_START}two${SYNC_END}`);
  });
});
