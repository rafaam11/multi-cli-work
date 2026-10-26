import { describe, expect, it } from "vitest";
import { closePane, gridColumns, loadPanes, MAX_PANES, placePane, savePanes } from "./pane-grid";

describe("placePane", () => {
  it("keeps a session that is already on screen where it is", () => {
    expect(placePane(["a", "b"], "a", "b")).toEqual(["a", "b"]);
  });

  it("fills an empty cell first", () => {
    expect(placePane(["a"], "a", "b")).toEqual(["a", "b"]);
  });

  it("replaces the focused cell once the grid is full", () => {
    expect(MAX_PANES).toBe(4);
    expect(placePane(["a", "b", "c", "d"], "b", "e")).toEqual(["a", "e", "c", "d"]);
    expect(placePane(["a", "b", "c", "d"], null, "e")).toEqual(["a", "b", "c", "e"]);
  });
});

describe("closePane", () => {
  it("keeps the focus when another cell closes", () => {
    expect(closePane(["a", "b"], "a", "b")).toEqual({ panes: ["a"], focusedId: "a" });
  });

  it("hands the focus to the neighbouring cell", () => {
    expect(closePane(["a", "b", "c"], "b", "b")).toEqual({ panes: ["a", "c"], focusedId: "c" });
    expect(closePane(["a", "b"], "b", "b")).toEqual({ panes: ["a"], focusedId: "a" });
    expect(closePane(["a"], "a", "a")).toEqual({ panes: [], focusedId: null });
  });
});

describe("gridColumns", () => {
  it("uses one column for one pane and two otherwise", () => {
    expect([1, 2, 3, 4].map(gridColumns)).toEqual([1, 2, 2, 2]);
  });
});

describe("stored panes", () => {
  it("round-trips per pairing and drops junk", () => {
    window.localStorage.clear();
    savePanes(window.localStorage, "d1", ["a", "b"]);
    expect(loadPanes(window.localStorage, "d1")).toEqual(["a", "b"]);
    expect(loadPanes(window.localStorage, "d2")).toEqual([]);
    window.localStorage.setItem("mcw.remote.panes.v1:d3", '["a", 3, "", "b", "c", "d", "e"]');
    expect(loadPanes(window.localStorage, "d3")).toEqual(["a", "b", "c", "d"]);
    window.localStorage.setItem("mcw.remote.panes.v1:d4", "{");
    expect(loadPanes(window.localStorage, "d4")).toEqual([]);
    expect(loadPanes(null, "d1")).toEqual([]);
  });
});
