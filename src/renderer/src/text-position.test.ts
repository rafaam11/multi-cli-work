import { describe, expect, it } from "vitest";
import { lineSelection } from "./text-position";

describe("lineSelection", () => {
  const text = "first\r\nsecond line\nthird";

  it("selects from the column to the end of the line, across LF and CRLF", () => {
    expect(lineSelection(text, 1, 1)).toEqual({ start: 0, end: 5 });
    expect(lineSelection(text, 2, 1)).toEqual({ start: 7, end: 18 });
    expect(lineSelection(text, 2, 8)).toEqual({ start: 14, end: 18 });
    expect(lineSelection(text, 3, 1)).toEqual({ start: 19, end: 24 });
  });

  it("clamps a line or column past the end instead of failing", () => {
    expect(lineSelection(text, 99, 1)).toEqual({ start: 19, end: 24 });
    expect(lineSelection(text, 1, 99)).toEqual({ start: 5, end: 5 });
    expect(lineSelection("", 3, 2)).toEqual({ start: 0, end: 0 });
  });
});
