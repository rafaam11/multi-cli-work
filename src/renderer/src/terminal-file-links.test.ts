import { describe, expect, it } from "vitest";
import { cellRange, findPathCandidates, logicalLineText, type BufferCell } from "./terminal-file-links";

const paths = (text: string) =>
  findPathCandidates(text).map(({ path, line, column }) => ({ path, line, column }));

describe("findPathCandidates", () => {
  it("finds relative, dotted, Windows and POSIX paths with line and column", () => {
    expect(paths("see src/app/main.ts:42 and ./README.md")).toEqual([
      { path: "src/app/main.ts", line: 42, column: null },
      { path: "./README.md", line: null, column: null },
    ]);
    expect(paths("at src\\a.ts:12:7 then C:\\dev\\x\\b.tsx and /home/me/c.py:3")).toEqual([
      { path: "src\\a.ts", line: 12, column: 7 },
      { path: "C:\\dev\\x\\b.tsx", line: null, column: null },
      { path: "/home/me/c.py", line: 3, column: null },
    ]);
  });

  it("reads the compiler style file(line,col) and a bare file name with an extension", () => {
    expect(paths("error in index.ts(12,3): bad")).toEqual([{ path: "index.ts", line: 12, column: 3 }]);
    expect(paths("Updated package.json")).toEqual([{ path: "package.json", line: null, column: null }]);
  });

  it("strips wrapping quotes, backticks, brackets and trailing punctuation", () => {
    expect(paths("Edit `src/a.ts`, then (lib/b.ts). \"c.md\": done.")).toEqual([
      { path: "src/a.ts", line: null, column: null },
      { path: "lib/b.ts", line: null, column: null },
      { path: "c.md", line: null, column: null },
    ]);
  });

  it("keeps Korean file names and leaves URLs and version numbers alone", () => {
    expect(paths("문서/설계 노트.md is not one, 문서/설계.md:3 is")).toEqual([
      { path: "노트.md", line: null, column: null },
      { path: "문서/설계.md", line: 3, column: null },
    ]);
    expect(paths("https://example.com/a/b.js and v1.2.3 and 10.5")).toEqual([]);
  });

  it("reports where in the text each candidate sits, suffix included", () => {
    const [candidate] = findPathCandidates("x src/a.ts:9 y");
    expect(candidate).toMatchObject({ start: 2, end: 12 });
  });
});

describe("logicalLineText and cellRange", () => {
  const row = (text: string): BufferCell[] =>
    [...text].flatMap((char) =>
      /[가-힣]/.test(char) ? [{ chars: char, width: 2 }, { chars: "", width: 0 }] : [{ chars: char, width: 1 }],
    );

  it("maps text offsets to cells, counting a Korean character as two cells", () => {
    const line = logicalLineText([row("한글 a.ts:3")], 5);
    expect(line.text).toBe("한글 a.ts:3");
    const [candidate] = findPathCandidates(line.text);
    // "한글 " takes five cells, so the link starts on the sixth (1-based) of buffer row 6.
    expect(cellRange(line, candidate.start, candidate.end)).toEqual({ start: { x: 6, y: 6 }, end: { x: 11, y: 6 } });
  });

  it("joins a path that wraps onto the next row", () => {
    const line = logicalLineText([row("open src/ve"), row("ry/long.ts now")], 0);
    expect(line.text).toBe("open src/very/long.ts now");
    const [candidate] = findPathCandidates(line.text);
    expect(candidate.path).toBe("src/very/long.ts");
    expect(cellRange(line, candidate.start, candidate.end)).toEqual({ start: { x: 6, y: 1 }, end: { x: 10, y: 2 } });
  });
});
