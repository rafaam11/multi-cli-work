import { describe, expect, it } from "vitest";
import type { GitGraphCommit } from "./api-types";
import { computeGitGraphLanes } from "./git-graph-lanes";

const commit = (hash: string, parents: string[]): GitGraphCommit => ({
  hash,
  parents,
  subject: hash,
  authorName: "A",
  authoredAt: "2026-01-01T00:00:00Z",
  refs: [],
});

describe("computeGitGraphLanes", () => {
  it("keeps a linear history in one lane", () => {
    expect(computeGitGraphLanes([commit("c", ["b"]), commit("b", ["a"]), commit("a", [])]).map((row) => row.lane)).toEqual([0, 0, 0]);
  });

  it("opens and rejoins a lane for a merge", () => {
    const rows = computeGitGraphLanes([
      commit("m", ["l", "r"]),
      commit("l", ["b"]),
      commit("r", ["b"]),
      commit("b", []),
    ]);
    expect(rows.map((row) => row.lane)).toEqual([0, 0, 1, 0]);
    expect(rows[0].lanesAfter).toEqual(["l", "r"]);
    expect(rows[2].lanesAfter).toEqual(["b"]);
  });
});
