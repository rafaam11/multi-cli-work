import { describe, expect, it } from "vitest";
import { droppedPathsAsPromptText } from "./drop-paths";

describe("droppedPathsAsPromptText", () => {
  it("quotes a single path and leaves the cursor after a trailing space", () => {
    expect(droppedPathsAsPromptText(["C:\\work\\shot 1.png"])).toBe('"C:\\work\\shot 1.png" ');
  });

  it("joins several paths with spaces", () => {
    expect(droppedPathsAsPromptText(["C:\\a.txt", "C:\\b.txt"])).toBe('"C:\\a.txt" "C:\\b.txt" ');
  });

  it("drops files that have no backing path and yields null when none remain", () => {
    expect(droppedPathsAsPromptText(["", "C:\\a.txt", ""])).toBe('"C:\\a.txt" ');
    expect(droppedPathsAsPromptText(["", ""])).toBeNull();
    expect(droppedPathsAsPromptText([])).toBeNull();
  });
});
