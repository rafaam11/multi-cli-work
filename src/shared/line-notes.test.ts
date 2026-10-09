import { describe, expect, it } from "vitest";
import { formatLineNotes, localDiffNotesPrompt } from "./line-notes";

const notes = [
  { path: "src/a.ts", side: "RIGHT" as const, line: 12, lineText: "const a = 1;", body: "이름을 바꿔 주세요" },
  { path: "src/b.ts", side: "LEFT" as const, line: 3, lineText: "", body: "왜 지웠나요?" },
];

describe("formatLineNotes", () => {
  it("numbers each note with its place, its code line and the request", () => {
    expect(formatLineNotes(notes)).toBe(
      [
        "## Note 1 · src/a.ts · RIGHT:12",
        "코드: const a = 1;",
        "요청: 이름을 바꿔 주세요",
        "",
        "## Note 2 · src/b.ts · LEFT:3",
        "코드: (빈 줄)",
        "요청: 왜 지웠나요?",
      ].join("\n"),
    );
  });
});

describe("localDiffNotesPrompt", () => {
  it("names the checkout and asks for the changes, then lists the notes", () => {
    const prompt = localDiffNotesPrompt("Atlas · feature/x", notes);
    expect(prompt).toContain("대상: Atlas · feature/x");
    expect(prompt).toContain("커밋 전 변경");
    expect(prompt.endsWith(formatLineNotes(notes))).toBe(true);
  });
});
