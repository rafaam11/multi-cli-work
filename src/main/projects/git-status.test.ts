// @vitest-environment node

import { describe, expect, it } from "vitest";
import { countChangedFiles } from "./git-status";

describe("git status porcelain parsing", () => {
  it("counts zero for a clean tree", () => {
    expect(countChangedFiles("")).toBe(0);
    expect(countChangedFiles("\n")).toBe(0);
  });

  it("counts one line per changed or untracked file", () => {
    expect(countChangedFiles(" M src/App.tsx\n?? new-file.ts\n")).toBe(2);
  });

  it("ignores a trailing blank line from the process output", () => {
    expect(countChangedFiles(" M src/App.tsx\n M src/Other.tsx\n\n")).toBe(2);
  });
});
