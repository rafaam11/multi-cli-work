import { describe, expect, it } from "vitest";
import {
  appendSession,
  clampPage,
  clearSlot,
  nextWorkspaceSlot,
  normalizeSlots,
  pageCount,
  pageOfSession,
  pageSlots,
  placeInSlot,
  removeSession,
  renamePaneId,
  resolveView,
  setLayout,
  viewPageSize,
  visibleSessionsOf,
} from "./slot-view";

describe("normalizeSlots", () => {
  it("starts a view nobody has arranged yet on 자동, so every session shows", () => {
    expect(normalizeSlots(undefined, ["a", "b", "c"], { autoAppend: true })).toEqual({
      layoutId: "auto",
      slots: ["a", "b", "c"],
    });
  });

  it("keeps the saved layout as sessions come and go", () => {
    const view = { layoutId: "2-col", slots: ["a"] };
    expect(normalizeSlots(view, ["a", "b", "c"], { autoAppend: true }).layoutId).toBe("2-col");
  });

  it("closes the grid up behind a session that is gone", () => {
    expect(normalizeSlots({ layoutId: "6-grid", slots: ["a", "gone", "c"] }, ["a", "c"])).toEqual({
      layoutId: "6-grid",
      slots: ["a", "c"],
    });
  });

  it("closes the gap instead in a 자동 view, which never holds an empty slot", () => {
    expect(normalizeSlots({ layoutId: "auto", slots: ["a", "gone", "c"] }, ["a", "c"])).toEqual({
      layoutId: "auto",
      slots: ["a", "c"],
    });
  });

  it("fills open slots before the end when auto-appending", () => {
    expect(
      normalizeSlots({ layoutId: "6-grid", slots: ["a", null, "c"] }, ["a", "c", "d", "e"], { autoAppend: true }),
    ).toEqual({ layoutId: "6-grid", slots: ["a", "d", "c", "e"] });
  });

  it("leaves the hole a drop reached past alone without auto-append", () => {
    expect(normalizeSlots({ layoutId: "6-grid", slots: ["a", null, "c"] }, ["a", "b", "c"])).toEqual({
      layoutId: "6-grid",
      slots: ["a", null, "c"],
    });
  });

  it("appends past the layout's slot count rather than dropping a session", () => {
    const view = normalizeSlots({ layoutId: "3-main-right", slots: ["a", "b", "c"] }, ["a", "b", "c", "d"], {
      autoAppend: true,
    });
    expect(view.slots).toEqual(["a", "b", "c", "d"]);
    expect(pageOfSession(view.slots, 3, "d")).toBe(1);
  });

  it("drops a repeated session, since one view shows it once", () => {
    expect(normalizeSlots({ layoutId: "6-grid", slots: ["a", "a", "b"] }, ["a", "b"])).toEqual({
      layoutId: "6-grid",
      slots: ["a", "b"],
    });
  });

  it("trims trailing holes, keeping the ones with panes after them", () => {
    expect(normalizeSlots({ layoutId: "6-grid", slots: [null, "a", null, null] }, ["a"]).slots).toEqual([null, "a"]);
  });

  it("reads an unknown layout id as a layout of the right size instead of blanking the view", () => {
    const view = normalizeSlots({ layoutId: "layout-from-a-future-version", slots: ["a", "b"] }, ["a", "b"]);
    expect(view.layoutId).toBe("layout-from-a-future-version");
    expect(viewPageSize(view)).toBe(2);
    expect(pageSlots(view.slots, viewPageSize(view), 0)).toEqual(["a", "b"]);
  });
});

describe("placeInSlot", () => {
  it("slides the panes between the two ends rather than trading places", () => {
    expect(placeInSlot({ layoutId: "6-grid", slots: ["a", "b", "c"] }, 0, "c").slots).toEqual(["c", "a", "b"]);
  });

  it("closes the slot a moved pane left behind", () => {
    expect(placeInSlot({ layoutId: "6-grid", slots: ["a", "b", "c", "d"] }, 2, "a").slots).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("pushes the pane it lands on back one slot rather than dropping it", () => {
    expect(placeInSlot({ layoutId: "6-grid", slots: ["a", "c"] }, 0, "new").slots).toEqual(["new", "a", "c"]);
  });

  it("pushes the whole tail back when the drop lands mid-grid", () => {
    expect(placeInSlot({ layoutId: "2-col", slots: ["a", "b"] }, 1, "new").slots).toEqual(["a", "new", "b"]);
  });

  it("does nothing when the session is already in that slot", () => {
    const view = { layoutId: "2-col", slots: ["a", "b"] };
    expect(placeInSlot(view, 0, "a")).toBe(view);
  });

  it("keeps the holes it padded to reach a slot past the end", () => {
    expect(placeInSlot({ layoutId: "6-grid", slots: ["a"] }, 3, "b").slots).toEqual(["a", null, null, "b"]);
  });

  it("lands right after the last pane in a 자동 view, however far past the end it was dropped", () => {
    expect(placeInSlot({ layoutId: "auto", slots: ["a"] }, 3, "b").slots).toEqual(["a", "b"]);
  });
});

describe("clearSlot", () => {
  it("pulls the panes behind it forward", () => {
    expect(clearSlot({ layoutId: "6-grid", slots: ["a", "b", "c"] }, 1).slots).toEqual(["a", "c"]);
  });

  it("shortens the view when the last pane leaves", () => {
    expect(clearSlot({ layoutId: "6-grid", slots: ["a", "b"] }, 1).slots).toEqual(["a"]);
  });

  it("pulls the rest forward in a 자동 view", () => {
    expect(clearSlot({ layoutId: "auto", slots: ["a", "b", "c"] }, 1).slots).toEqual(["a", "c"]);
  });

  it("ignores a slot the view does not have", () => {
    const view = { layoutId: "6-grid", slots: ["a"] };
    expect(clearSlot(view, 4)).toBe(view);
    expect(clearSlot(view, -1)).toBe(view);
  });
});

describe("appendSession", () => {
  it("takes the first open slot", () => {
    expect(appendSession({ layoutId: "6-grid", slots: ["a", null, "c"] }, "d").slots).toEqual(["a", "d", "c"]);
  });

  it("goes to the end when nothing is open", () => {
    expect(appendSession({ layoutId: "2-col", slots: ["a", "b"] }, "c").slots).toEqual(["a", "b", "c"]);
  });

  it("ignores a session the view already holds", () => {
    const view = { layoutId: "2-col", slots: ["a", "b"] };
    expect(appendSession(view, "a")).toBe(view);
  });
});

describe("removeSession", () => {
  it("closes the grid up so no gap is left behind", () => {
    expect(removeSession({ layoutId: "6-grid", slots: ["a", "b", "c"] }, "b").slots).toEqual(["a", "c"]);
  });

  it("returns the same view when the session was never here", () => {
    const view = { layoutId: "6-grid", slots: ["a"] };
    expect(removeSession(view, "zz")).toBe(view);
  });
});

describe("renamePaneId", () => {
  it("keeps the slot a renamed document was in", () => {
    expect(renamePaneId({ layoutId: "6-grid", slots: ["a", "old", "c"] }, "old", "new").slots).toEqual([
      "a",
      "new",
      "c",
    ]);
  });

  it("returns the same view when the pane is not in it", () => {
    const view = { layoutId: "6-grid", slots: ["a"] };
    expect(renamePaneId(view, "old", "new")).toBe(view);
  });
});

describe("setLayout", () => {
  it("changes the layout without disturbing the slots", () => {
    expect(setLayout({ layoutId: "6-grid", slots: ["a", "b"] }, "2-col")).toEqual({
      layoutId: "2-col",
      slots: ["a", "b"],
    });
  });

  it("closes the holes on the way into 자동, which has nowhere to draw them", () => {
    expect(setLayout({ layoutId: "6-grid", slots: ["a", null, "c"] }, "auto")).toEqual({
      layoutId: "auto",
      slots: ["a", "c"],
    });
  });
});

describe("pagination", () => {
  it("counts one page for an empty view", () => {
    expect(pageCount([], 6)).toBe(1);
  });

  it("splits the slots by the page size", () => {
    const slots = ["a", "b", "c", "d"];
    expect(pageCount(slots, 3)).toBe(2);
    expect(pageSlots(slots, 3, 0)).toEqual(["a", "b", "c"]);
    expect(pageSlots(slots, 3, 1)).toEqual(["d", null, null]);
  });

  it("moves sessions onto the first page when the layout grows", () => {
    const slots = ["a", "b", "c", "d"];
    expect(pageCount(slots, 6)).toBe(1);
    expect(pageSlots(slots, 6, 0)).toEqual(["a", "b", "c", "d", null, null]);
  });

  it("always hands the grid exactly as many cells as the page holds", () => {
    expect(pageSlots([], 3, 0)).toHaveLength(3);
    expect(pageSlots(["a"], 6, 0)).toHaveLength(6);
  });

  it("clamps a page beyond the end instead of showing nothing", () => {
    expect(pageSlots(["a", "b", "c", "d"], 3, 9)).toEqual(["d", null, null]);
    expect(clampPage(-2, 3)).toBe(0);
    expect(clampPage(9, 3)).toBe(2);
    expect(clampPage(0, 0)).toBe(0);
  });

  it("finds the page a session is on", () => {
    const slots = ["a", "b", "c", null, "e"];
    expect(pageOfSession(slots, 3, "a")).toBe(0);
    expect(pageOfSession(slots, 3, "e")).toBe(1);
    expect(pageOfSession(slots, 3, "zz")).toBeNull();
  });

  it("reports only the sessions the page actually shows", () => {
    const slots = ["a", null, "c", "d"];
    expect(visibleSessionsOf(slots, 3, 0)).toEqual(["a", "c"]);
    expect(visibleSessionsOf(slots, 3, 1)).toEqual(["d"]);
  });
});

describe("viewPageSize", () => {
  it("takes the count from the chosen preset", () => {
    expect(viewPageSize({ layoutId: "3-main-right", slots: [] })).toBe(3);
  });

  it("lets 자동 hold a full six before spilling onto a second page", () => {
    expect(viewPageSize({ layoutId: "auto", slots: [] })).toBe(6);
  });
});

describe("resolveView", () => {
  it("climbs the 자동 ladder with the number of sessions on the page", () => {
    const ladder = ["solo", "2-col", "3-col", "4-thirds-right", "5-main-quad", "6-grid"];
    ladder.forEach((layoutId, index) => {
      const slots = Array.from({ length: index + 1 }, (_, slot) => `s${slot}`);
      const view = resolveView({ layoutId: "auto", slots }, 0);
      expect(view.layout.id).toBe(layoutId);
      expect(view.slots).toEqual(slots);
    });
  });

  it("gives a 자동 page of its own layout once sessions spill over", () => {
    const view = { layoutId: "auto", slots: ["a", "b", "c", "d", "e", "f", "g", "h"] };
    expect(resolveView(view, 0).layout.id).toBe("6-grid");
    const second = resolveView(view, 1);
    expect(second.layout.id).toBe("2-col");
    expect(second.slots).toEqual(["g", "h"]);
    expect(second.pages).toBe(2);
  });

  it("draws one empty slot for a 자동 view holding nothing", () => {
    const view = resolveView({ layoutId: "auto", slots: [] }, 0);
    expect(view.layout.id).toBe("solo");
    expect(view.slots).toEqual([null]);
  });

  it("keeps a preset's empty slots as the drop targets they are", () => {
    const view = resolveView({ layoutId: "4-quad", slots: ["a", null, "c"] }, 0);
    expect(view.layout.id).toBe("4-quad");
    expect(view.slots).toEqual(["a", null, "c", null]);
  });

  it("clamps a page past the end back onto the last one", () => {
    const view = resolveView({ layoutId: "3-main-right", slots: ["a", "b", "c", "d"] }, 9);
    expect(view.page).toBe(1);
    expect(view.pages).toBe(2);
    expect(view.slots).toEqual(["d", null, null]);
  });
});

describe("nextWorkspaceSlot", () => {
  /** A full page of panes, named so a failure says which workspace the slot came from. */
  const full = (prefix: string, count = 6): string[] =>
    Array.from({ length: count }, (_, index) => `${prefix}${index}`);
  const auto = (slots: (string | null)[] = []) => ({ layoutId: "auto", slots });

  it("fills 작업공간1 from the first slot before it looks anywhere else", () => {
    expect(nextWorkspaceSlot([auto(), auto(), auto()])).toEqual({ index: 0, slot: 0 });
    expect(nextWorkspaceSlot([auto(["a", "b"]), auto(), auto()])).toEqual({ index: 0, slot: 2 });
  });

  it("steps to the next workspace once a page is full", () => {
    expect(nextWorkspaceSlot([auto(full("a")), auto(), auto()])).toEqual({ index: 1, slot: 0 });
    expect(nextWorkspaceSlot([auto(full("a")), auto(full("b")), auto()])).toEqual({ index: 2, slot: 0 });
  });

  it("opens 작업공간1's second page only once all three first pages are full", () => {
    const shelf = [auto(full("a")), auto(full("b")), auto(full("c"))];
    expect(nextWorkspaceSlot(shelf)).toEqual({ index: 0, slot: 6 });
    // That second page fills its own six before 작업공간2's second page opens.
    expect(nextWorkspaceSlot([auto([...full("a"), "a6"]), shelf[1], shelf[2]])).toEqual({
      index: 0,
      slot: 7,
    });
    expect(nextWorkspaceSlot([auto(full("a", 12)), shelf[1], shelf[2]])).toEqual({
      index: 1,
      slot: 6,
    });
  });

  it("fills a hole a drop reached past before opening a new page", () => {
    const shelf = [
      { layoutId: "6-grid", slots: ["a", null, "c", "d", "e", "f"] },
      { layoutId: "6-grid", slots: full("b") },
      { layoutId: "6-grid", slots: full("c") },
    ];
    expect(nextWorkspaceSlot(shelf)).toEqual({ index: 0, slot: 1 });
  });

  it("counts a page by the workspace's own layout rather than a fixed six", () => {
    expect(nextWorkspaceSlot([{ layoutId: "2-col", slots: ["a", "b"] }, auto(), auto()])).toEqual({
      index: 1,
      slot: 0,
    });
  });

  it("has nowhere to shelve a pane when there are no workspaces", () => {
    expect(nextWorkspaceSlot([])).toBeNull();
  });
});
