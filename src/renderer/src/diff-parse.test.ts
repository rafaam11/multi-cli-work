import { describe, expect, it } from "vitest";
import { parseDiffFile, parseUnifiedDiff } from "./diff-parse";

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
    expect(files[1].lines.filter((line) => line.kind === "add")).toEqual([
      expect.objectContaining({ kind: "add", text: "+new", oldLine: null, newLine: 1 }),
    ]);
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

  it("tracks old and new line numbers across multiple hunks", () => {
    const file = parseDiffFile("x.ts", [
      "@@ -2,3 +4,4 @@ function x()",
      " same",
      "-old",
      "+new",
      "+extra",
      " tail",
      "@@ -20 +30 @@",
      "-gone",
      "+here",
    ].join("\n"));

    expect(file.lines.map(({ kind, oldLine, newLine }) => ({ kind, oldLine, newLine }))).toEqual([
      { kind: "hunk", oldLine: null, newLine: null },
      { kind: "context", oldLine: 2, newLine: 4 },
      { kind: "del", oldLine: 3, newLine: null },
      { kind: "add", oldLine: null, newLine: 5 },
      { kind: "add", oldLine: null, newLine: 6 },
      { kind: "context", oldLine: 4, newLine: 7 },
      { kind: "hunk", oldLine: null, newLine: null },
      { kind: "del", oldLine: 20, newLine: null },
      { kind: "add", oldLine: null, newLine: 30 },
    ]);
    expect(new Set(file.lines.map((line) => line.id)).size).toBe(file.lines.length);
  });

  it("describes binary, rename, new, deleted, no-newline and truncated patches", () => {
    expect(parseDiffFile("asset.png", "Binary files a/asset.png and b/asset.png differ").binary).toBe(true);
    expect(parseDiffFile("new.ts", "new file mode 100644\n@@ -0,0 +1 @@\n+x").changeType).toBe("added");
    expect(parseDiffFile("old.ts", "deleted file mode 100644\n@@ -1 +0,0 @@\n-x").changeType).toBe("deleted");
    expect(parseDiffFile("new-name", "similarity index 100%\nrename from old-name\nrename to new-name").changeType).toBe("renamed");
    expect(parseDiffFile("x", "@@ -1 +1 @@\n-x\n\\ No newline at end of file\n+y", true)).toMatchObject({ truncated: true, noNewline: true });
  });
});
