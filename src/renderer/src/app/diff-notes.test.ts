import { describe, expect, it } from "vitest";
import { MAX_DIFF_NOTES, parseDiffNotes, pruneDiffNotes, type LocalDiffNote } from "./diff-notes";

const DAY = 24 * 60 * 60 * 1_000;

function note(id: string, overrides: Partial<LocalDiffNote> = {}): LocalDiffNote {
  return {
    id,
    targetKey: "project:p1",
    path: "src/a.ts",
    side: "RIGHT",
    line: 1,
    lineText: "x",
    body: "fix",
    status: "draft",
    createdAt: 1_000,
    sentAt: null,
    ...overrides,
  };
}

describe("parseDiffNotes", () => {
  it("keeps well-formed notes and drops anything else", () => {
    const raw = JSON.stringify({ version: 1, notes: [note("a"), { id: "broken" }, note("b", { side: "UP" as "LEFT" })] });
    expect(parseDiffNotes(raw).map((entry) => entry.id)).toEqual(["a"]);
  });

  it("starts empty on missing or unreadable storage", () => {
    expect(parseDiffNotes(null)).toEqual([]);
    expect(parseDiffNotes("{not json")).toEqual([]);
    expect(parseDiffNotes(JSON.stringify({ version: 2, notes: [note("a")] }))).toEqual([]);
  });
});

describe("pruneDiffNotes", () => {
  it("forgets sent notes after a week and notes of checkouts that are gone", () => {
    const now = 30 * DAY;
    const notes = [
      note("old-sent", { status: "sent", sentAt: now - 8 * DAY }),
      note("new-sent", { status: "sent", sentAt: now - DAY }),
      note("draft"),
      note("gone", { targetKey: "worktree:w9" }),
    ];
    expect(pruneDiffNotes(notes, now, new Set(["project:p1"])).map((entry) => entry.id)).toEqual(["new-sent", "draft"]);
  });

  it("caps the total, letting go of sent notes before drafts", () => {
    const drafts = Array.from({ length: MAX_DIFF_NOTES }, (_, index) => note(`d${index}`, { createdAt: index }));
    const sent = note("s", { status: "sent", sentAt: 5, createdAt: 9_999 });
    const pruned = pruneDiffNotes([sent, ...drafts], 10, null);
    expect(pruned).toHaveLength(MAX_DIFF_NOTES);
    expect(pruned.some((entry) => entry.id === "s")).toBe(false);
  });
});
