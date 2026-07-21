import { describe, expect, it } from "vitest";
import { layoutGitGraph } from "./git-graph-layout";

const commit = (hash: string, ...parents: string[]) => ({ hash, parents });

/** Lanes and colours keyed by hash, which reads better in assertions than positional arrays. */
function nodesByHash(commits: { hash: string; parents: string[] }[]) {
  const layout = layoutGitGraph(commits);
  return {
    layout,
    lane: (hash: string) => layout.nodes.find((node) => node.hash === hash)?.lane,
    color: (hash: string) => layout.nodes.find((node) => node.hash === hash)?.colorIndex,
  };
}

describe("layoutGitGraph", () => {
  it("keeps a linear history in one lane and one colour", () => {
    const layout = layoutGitGraph([commit("c", "b"), commit("b", "a"), commit("a")]);

    expect(layout.nodes.map((node) => node.lane)).toEqual([0, 0, 0]);
    // The regression that made the old graph look wrong: colour must follow the branch, not the column.
    expect(layout.nodes.map((node) => node.colorIndex)).toEqual([0, 0, 0]);
    expect(layout.laneCount).toBe(1);
  });

  it("opens a lane for a merge and rejoins it", () => {
    const layout = layoutGitGraph([commit("m", "l", "r"), commit("l", "b"), commit("r", "b"), commit("b")]);

    expect(layout.nodes.map((node) => node.lane)).toEqual([0, 0, 1, 0]);
    expect(layout.laneCount).toBe(2);
    expect(layout.edges.filter((edge) => edge.isMerge)).toHaveLength(1);
  });

  it("keeps a branch's colour when it changes lane", () => {
    // "r" lives in lane 1 but its parent "b" sits back in lane 0; the join keeps r's colour.
    const { color, layout } = nodesByHash([commit("m", "l", "r"), commit("l", "b"), commit("r", "b"), commit("b")]);
    const join = layout.edges.find((edge) => edge.fromLane === 1 && edge.toLane === 0);

    expect(color("m")).toBe(color("l"));
    expect(color("r")).not.toBe(color("m"));
    expect(join?.colorIndex).toBe(color("r"));
  });

  it("fans an octopus merge into one lane per extra parent", () => {
    const layout = layoutGitGraph([
      commit("o", "a", "b", "c", "d"),
      commit("a", "root"),
      commit("b", "root"),
      commit("c", "root"),
      commit("d", "root"),
      commit("root"),
    ]);

    expect(layout.laneCount).toBe(4);
    expect(layout.edges.filter((edge) => edge.isMerge)).toHaveLength(3);
    expect(layout.nodes.at(-1)?.lane).toBe(0);
  });

  it("gives a root commit a node but no edges", () => {
    const layout = layoutGitGraph([commit("only")]);

    expect(layout.nodes).toEqual([{ hash: "only", row: 0, lane: 0, colorIndex: 0 }]);
    expect(layout.edges).toEqual([]);
  });

  it("marks a parent outside the loaded pages instead of pointing at nothing", () => {
    // The old renderer resolved this to lane -1 and drew the line off the left of the canvas; every
    // commit at a page boundary hit it.
    const layout = layoutGitGraph([commit("tip", "notloaded")]);

    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].toRow).toBeNull();
    expect(layout.edges[0].toLane).toBe(0);
  });

  it("reuses a lane once its commit is consumed", () => {
    const layout = layoutGitGraph([
      commit("d", "c"),
      commit("c", "b", "x"),
      commit("b", "a"),
      commit("x", "a"),
      commit("a"),
    ]);

    expect(layout.laneCount).toBe(2);
  });

  it("does not burn a palette entry on a parent that already has a colour", () => {
    // "b" is coloured when "x" claims it, so the merge in "m" must not spend a fresh colour on it —
    // otherwise every later branch is shifted along the palette and colours appear to skip.
    const { color } = nodesByHash([
      commit("x", "b"),
      commit("m", "a", "b"),
      commit("a"),
      commit("y", "b"),
      commit("b"),
    ]);

    expect(color("x")).toBe(0);
    expect(color("m")).toBe(1);
    expect(color("y")).toBe(2);
  });

  it("returns an empty layout for an empty log", () => {
    expect(layoutGitGraph([])).toEqual({ nodes: [], edges: [], laneCount: 0 });
  });
});
