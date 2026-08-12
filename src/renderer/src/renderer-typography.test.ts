import { describe, expect, it } from "vitest";
import { CONTENT_TYPOGRAPHY, MONACO_DIFF_TYPOGRAPHY } from "./renderer-typography";

describe("renderer typography", () => {
  it("shares 13px code text between xterm and Monaco and keeps xterm at 1.25 line height", () => {
    expect(CONTENT_TYPOGRAPHY).toEqual({ codeFontSize: 13, terminalLineHeight: 1.25 });
    expect(MONACO_DIFF_TYPOGRAPHY).toEqual({ fontSize: CONTENT_TYPOGRAPHY.codeFontSize });
  });
});
