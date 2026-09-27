import { describe, expect, it } from "vitest";
import { stripTerminalControls } from "./terminal-text";

describe("stripTerminalControls", () => {
  it("drops colours, cursor moves and erases but keeps the words and line breaks", () => {
    expect(stripTerminalControls("\u001b[32mMCW_ANSI_GREEN\u001b[0m\r\n\u001b[2K\u001b[1;5Hdone\r\n")).toBe(
      "MCW_ANSI_GREEN\ndone\n",
    );
  });

  it("drops OSC titles, hyperlinks and notifications whether ended by BEL or ST", () => {
    const hyperlink = "\u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\";
    expect(stripTerminalControls(`\u001b]0;title\u0007${hyperlink}\u001b]9;ping\u0007`)).toBe("link");
  });

  it("drops private modes, short escapes and stray control bytes, keeping tabs", () => {
    expect(stripTerminalControls("\u001b[?2026h\u001b(B\u001b7a\tb\u0008\u001b[?25l\u0007c")).toBe("a\tbc");
  });

  it("leaves plain text, including Korean, untouched", () => {
    expect(stripTerminalControls("세션 이름 = 하는 일\n")).toBe("세션 이름 = 하는 일\n");
  });
});
