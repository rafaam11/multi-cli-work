import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./diff-parse";

const SAMPLE = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 123..456 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,3 +1,3 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "diff --git a/readme.md b/readme.md",
  "@@ -1 +1 @@",
  "-old",
  "+new",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("splits files and classifies lines", () => {
    const files = parseUnifiedDiff(SAMPLE);

    expect(files.map((file) => file.path)).toEqual(["src/app.ts", "readme.md"]);
    expect(files[0].lines.map((line) => line.kind)).toEqual([
      "meta",
      "meta",
      "meta",
      "hunk",
      "context",
      "del",
      "add",
    ]);
    expect(files[1].lines.filter((line) => line.kind === "add")).toEqual([{ kind: "add", text: "+new" }]);
  });

  it("unquotes paths that contain spaces", () => {
    const files = parseUnifiedDiff('diff --git "a/my file.txt" "b/my file.txt"\n+x');

    expect(files[0].path).toBe("my file.txt");
  });

  it("returns nothing for an empty diff", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("distinguishes +++/--- headers from added and removed lines", () => {
    const files = parseUnifiedDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n-gone\n+here");

    expect(files[0].lines.map((line) => line.kind)).toEqual(["meta", "meta", "del", "add"]);
  });
});
