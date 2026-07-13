import { describe, expect, it } from "vitest";
import { fuzzyScore, rankQuickOpen, type QuickOpenItem } from "./quick-open";

function item(key: string, label: string, detail: string | null = null): QuickOpenItem {
  return { key, kind: "session", label, detail };
}

describe("fuzzyScore", () => {
  it("rejects a query whose characters do not appear in order", () => {
    expect(fuzzyScore("xyz", "Claude Code")).toBeNull();
    expect(fuzzyScore("edoc", "Code")).toBeNull();
  });

  it("scores consecutive runs above scattered matches", () => {
    const consecutive = fuzzyScore("clau", "Claude Code");
    const scattered = fuzzyScore("clau", "encyclopedia usual");
    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(consecutive!).toBeGreaterThan(scattered!);
  });

  it("rewards word starts, matching case-insensitively", () => {
    const wordStart = fuzzyScore("cc", "Claude Code");
    const midWord = fuzzyScore("cc", "occurrence");
    expect(wordStart!).toBeGreaterThan(midWord!);
  });

  it("ignores spaces in the query", () => {
    expect(fuzzyScore("claude code", "Claude Code")).not.toBeNull();
  });
});

describe("rankQuickOpen", () => {
  const items = [
    item("s1", "PowerShell", "Atlas"),
    item("s2", "Claude Code", "Atlas"),
    item("p1", "Atlas", "C:\\work\\atlas"),
    item("c1", "홈 대시보드 열기"),
  ];

  it("keeps the caller's order for an empty query and applies the limit", () => {
    expect(rankQuickOpen(items, "").map((entry) => entry.key)).toEqual(["s1", "s2", "p1", "c1"]);
    expect(rankQuickOpen(items, "", 2).map((entry) => entry.key)).toEqual(["s1", "s2"]);
  });

  it("filters out items that do not match", () => {
    expect(rankQuickOpen(items, "claude").map((entry) => entry.key)).toEqual(["s2"]);
  });

  it("matches against the detail text too", () => {
    const keys = rankQuickOpen(items, "atlas").map((entry) => entry.key);
    expect(keys).toContain("s1");
    expect(keys).toContain("p1");
  });

  it("breaks score ties by the caller's order", () => {
    const twins = [item("a", "Session"), item("b", "Session")];
    expect(rankQuickOpen(twins, "ses").map((entry) => entry.key)).toEqual(["a", "b"]);
  });
});
