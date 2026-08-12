import { describe, expect, it } from "vitest";
import { MAX_COLUMNS, MAX_ROWS_PER_COLUMN, buildLayout } from "./grid-layouts";
import {
  appendSession,
  clampPage,
  clearSlot,
  mergeColumnAt,
  normalizeSlots,
  pageCount,
  pageOfSession,
  pageSlots,
  placeInSlot,
  removeSession,
  renamePaneId,
  resolveView,
  setLayout,
  splitColumnAt,
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
    const view = { layoutId: "cols:1-1", slots: ["a"] };
    expect(normalizeSlots(view, ["a", "b", "c"], { autoAppend: true }).layoutId).toBe("cols:1-1");
  });

  it("closes the grid up behind a session that is gone", () => {
    expect(normalizeSlots({ layoutId: "cols:2-2-2", slots: ["a", "gone", "c"] }, ["a", "c"])).toEqual({
      layoutId: "cols:2-2-2",
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
      normalizeSlots({ layoutId: "cols:2-2-2", slots: ["a", null, "c"] }, ["a", "c", "d", "e"], { autoAppend: true }),
    ).toEqual({ layoutId: "cols:2-2-2", slots: ["a", "d", "c", "e"] });
  });

  it("leaves the hole a drop reached past alone without auto-append", () => {
    expect(normalizeSlots({ layoutId: "cols:2-2-2", slots: ["a", null, "c"] }, ["a", "b", "c"])).toEqual({
      layoutId: "cols:2-2-2",
      slots: ["a", null, "c"],
    });
  });

  it("appends past the layout's slot count rather than dropping a session", () => {
    const view = normalizeSlots({ layoutId: "cols:1-2", slots: ["a", "b", "c"] }, ["a", "b", "c", "d"], {
      autoAppend: true,
    });
    expect(view.slots).toEqual(["a", "b", "c", "d"]);
    expect(pageOfSession(view.slots, 3, "d")).toBe(1);
  });

  it("drops a repeated session, since one view shows it once", () => {
    expect(normalizeSlots({ layoutId: "cols:2-2-2", slots: ["a", "a", "b"] }, ["a", "b"])).toEqual({
      layoutId: "cols:2-2-2",
      slots: ["a", "b"],
    });
  });

  it("trims trailing holes, keeping the ones with panes after them", () => {
    expect(normalizeSlots({ layoutId: "cols:2-2-2", slots: [null, "a", null, null] }, ["a"]).slots).toEqual([null, "a"]);
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
    expect(placeInSlot({ layoutId: "cols:2-2-2", slots: ["a", "b", "c"] }, 0, "c").slots).toEqual(["c", "a", "b"]);
  });

  it("closes the slot a moved pane left behind", () => {
    expect(placeInSlot({ layoutId: "cols:2-2-2", slots: ["a", "b", "c", "d"] }, 2, "a").slots).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("pushes the pane it lands on back one slot rather than dropping it", () => {
    expect(placeInSlot({ layoutId: "cols:2-2-2", slots: ["a", "c"] }, 0, "new").slots).toEqual(["new", "a", "c"]);
  });

  it("pushes the whole tail back when the drop lands mid-grid", () => {
    expect(placeInSlot({ layoutId: "cols:1-1", slots: ["a", "b"] }, 1, "new").slots).toEqual(["a", "new", "b"]);
  });

  it("does nothing when the session is already in that slot", () => {
    const view = { layoutId: "cols:1-1", slots: ["a", "b"] };
    expect(placeInSlot(view, 0, "a")).toBe(view);
  });

  it("keeps the holes it padded to reach a slot past the end", () => {
    expect(placeInSlot({ layoutId: "cols:2-2-2", slots: ["a"] }, 3, "b").slots).toEqual(["a", null, null, "b"]);
  });

  it("lands right after the last pane in a 자동 view, however far past the end it was dropped", () => {
    expect(placeInSlot({ layoutId: "auto", slots: ["a"] }, 3, "b").slots).toEqual(["a", "b"]);
  });
});

describe("clearSlot", () => {
  it("pulls the panes behind it forward", () => {
    expect(clearSlot({ layoutId: "cols:2-2-2", slots: ["a", "b", "c"] }, 1).slots).toEqual(["a", "c"]);
  });

  it("shortens the view when the last pane leaves", () => {
    expect(clearSlot({ layoutId: "cols:2-2-2", slots: ["a", "b"] }, 1).slots).toEqual(["a"]);
  });

  it("pulls the rest forward in a 자동 view", () => {
    expect(clearSlot({ layoutId: "auto", slots: ["a", "b", "c"] }, 1).slots).toEqual(["a", "c"]);
  });

  it("ignores a slot the view does not have", () => {
    const view = { layoutId: "cols:2-2-2", slots: ["a"] };
    expect(clearSlot(view, 4)).toBe(view);
    expect(clearSlot(view, -1)).toBe(view);
  });
});

describe("appendSession", () => {
  it("takes the first open slot", () => {
    expect(appendSession({ layoutId: "cols:2-2-2", slots: ["a", null, "c"] }, "d").slots).toEqual(["a", "d", "c"]);
  });

  it("goes to the end when nothing is open", () => {
    expect(appendSession({ layoutId: "cols:1-1", slots: ["a", "b"] }, "c").slots).toEqual(["a", "b", "c"]);
  });

  it("ignores a session the view already holds", () => {
    const view = { layoutId: "cols:1-1", slots: ["a", "b"] };
    expect(appendSession(view, "a")).toBe(view);
  });
});

describe("removeSession", () => {
  it("closes the grid up so no gap is left behind", () => {
    expect(removeSession({ layoutId: "cols:2-2-2", slots: ["a", "b", "c"] }, "b").slots).toEqual(["a", "c"]);
  });

  it("returns the same view when the session was never here", () => {
    const view = { layoutId: "cols:2-2-2", slots: ["a"] };
    expect(removeSession(view, "zz")).toBe(view);
  });
});

describe("renamePaneId", () => {
  it("keeps the slot a renamed document was in", () => {
    expect(renamePaneId({ layoutId: "cols:2-2-2", slots: ["a", "old", "c"] }, "old", "new").slots).toEqual([
      "a",
      "new",
      "c",
    ]);
  });

  it("returns the same view when the pane is not in it", () => {
    const view = { layoutId: "cols:2-2-2", slots: ["a"] };
    expect(renamePaneId(view, "old", "new")).toBe(view);
  });
});

describe("setLayout", () => {
  it("changes the layout without disturbing the slots", () => {
    expect(setLayout({ layoutId: "cols:2-2-2", slots: ["a", "b"] }, "cols:1-1")).toEqual({
      layoutId: "cols:1-1",
      slots: ["a", "b"],
    });
  });

  it("closes the holes on the way into 자동, which has nowhere to draw them", () => {
    expect(setLayout({ layoutId: "cols:2-2-2", slots: ["a", null, "c"] }, "auto")).toEqual({
      layoutId: "auto",
      slots: ["a", "c"],
    });
  });
});

describe("splitColumnAt", () => {
  it("opens an empty row under the pane that asked, leaving the other columns alone", () => {
    const layout = buildLayout([1, 1, 1]);
    expect(splitColumnAt({ layoutId: layout.id, slots: ["a", "b", "c"] }, layout, 0, 1)).toEqual({
      layoutId: "cols:1-2-1",
      slots: ["a", "b", null, "c"],
    });
  });

  it("splits the first column without renumbering anything to its left, because there is none", () => {
    const layout = buildLayout([1, 1, 1]);
    expect(splitColumnAt({ layoutId: layout.id, slots: ["a", "b", "c"] }, layout, 0, 0).slots).toEqual([
      "a",
      null,
      "b",
      "c",
    ]);
  });

  it("trims the new row away when nothing follows it, since it is a trailing hole", () => {
    const layout = buildLayout([1, 1, 1]);
    expect(splitColumnAt({ layoutId: layout.id, slots: ["a", "b", "c"] }, layout, 0, 2)).toEqual({
      layoutId: "cols:1-1-2",
      slots: ["a", "b", "c"],
    });
  });

  /** 자동 means one column per session, which has no room for a stacked pair. */
  it("pins a 자동 view to the arrangement the split asked for", () => {
    const layout = buildLayout([1, 1]);
    expect(splitColumnAt({ layoutId: "auto", slots: ["a", "b"] }, layout, 0, 0)).toEqual({
      layoutId: "cols:2-1",
      slots: ["a", null, "b"],
    });
  });

  it("counts from the page on screen rather than the first one", () => {
    const layout = buildLayout([1, 1, 1]);
    const view = { layoutId: layout.id, slots: ["a", "b", "c", "d", "e", "f"] };
    // "d" is the first pane of page 2, so the empty row opens directly behind it in slot order.
    expect(splitColumnAt(view, layout, 1, 0).slots).toEqual(["a", "b", "c", "d", null, "e", "f"]);
  });

  /**
   * A 자동 page draws one column per pane, so its last page is narrower than the six-slot stride
   * that got the user there. Counting by the drawn layout would land the new row on another page.
   */
  it("counts a 자동 page by its stride, not by the columns that page happens to draw", () => {
    const view = { layoutId: "auto", slots: ["a", "b", "c", "d", "e", "f", "g", "h"] };
    // Page 2 holds "g" and "h", so it draws two columns — but it still starts at slot 6.
    expect(splitColumnAt(view, buildLayout([1, 1]), 1, 0).slots).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      null,
      "h",
    ]);
  });

  it("refuses a column that already has its second row", () => {
    const layout = buildLayout([2, 1]);
    const view = { layoutId: layout.id, slots: ["a", "b", "c"] };
    expect(splitColumnAt(view, layout, 0, 0)).toBe(view);
    expect(splitColumnAt(view, layout, 0, 1)).toBe(view);
  });

  /** Six columns of two rows is the cap, and it is reached only when every column is already split. */
  it("refuses every column of a full page", () => {
    const full = buildLayout(Array.from({ length: MAX_COLUMNS }, () => MAX_ROWS_PER_COLUMN));
    const view = { layoutId: full.id, slots: [] };
    for (let slot = 0; slot < full.slots; slot += 1) expect(splitColumnAt(view, full, 0, slot)).toBe(view);
  });

  it("refuses a slot the layout does not draw", () => {
    const layout = buildLayout([1, 1]);
    const view = { layoutId: layout.id, slots: ["a", "b"] };
    expect(splitColumnAt(view, layout, 0, 2)).toBe(view);
    expect(splitColumnAt(view, layout, 0, -1)).toBe(view);
  });
});

describe("mergeColumnAt", () => {
  it("gives the column back to its top pane and closes up behind the lower one", () => {
    const layout = buildLayout([1, 2, 1]);
    expect(mergeColumnAt({ layoutId: layout.id, slots: ["a", "b", "c", "d"] }, layout, 0, 1)).toEqual({
      layoutId: "cols:1-1-1",
      slots: ["a", "b", "d"],
    });
  });

  it("answers the same whichever of the two panes pressed the button", () => {
    const layout = buildLayout([1, 2, 1]);
    const view = { layoutId: layout.id, slots: ["a", "b", "c", "d"] };
    expect(mergeColumnAt(view, layout, 0, 2)).toEqual(mergeColumnAt(view, layout, 0, 1));
  });

  it("has nothing to close up when the lower row was empty", () => {
    const layout = buildLayout([2]);
    expect(mergeColumnAt({ layoutId: layout.id, slots: ["a"] }, layout, 0, 0)).toEqual({
      layoutId: "cols:1",
      slots: ["a"],
    });
  });

  it("counts from the page on screen rather than the first one", () => {
    const layout = buildLayout([1, 2, 1]);
    const view = { layoutId: layout.id, slots: ["a", "b", "c", "d", "e", "f", "g", "h"] };
    expect(mergeColumnAt(view, layout, 1, 1).slots).toEqual(["a", "b", "c", "d", "e", "f", "h"]);
  });

  it("refuses a column that is already one pane tall, 자동 included", () => {
    const layout = buildLayout([1, 1]);
    const view = { layoutId: layout.id, slots: ["a", "b"] };
    expect(mergeColumnAt(view, layout, 0, 0)).toBe(view);
    const auto = { layoutId: "auto", slots: ["a", "b"] };
    expect(mergeColumnAt(auto, layout, 0, 0)).toBe(auto);
  });

  it("refuses a slot the layout does not draw", () => {
    const layout = buildLayout([2, 1]);
    const view = { layoutId: layout.id, slots: ["a", "b", "c"] };
    expect(mergeColumnAt(view, layout, 0, 3)).toBe(view);
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
    expect(viewPageSize({ layoutId: "cols:1-2", slots: [] })).toBe(3);
  });

  /** 자동 only ever draws whole columns, so its ceiling is the column cap and not the slot cap. */
  it("lets 자동 hold a full six before spilling onto a second page", () => {
    expect(viewPageSize({ layoutId: "auto", slots: [] })).toBe(MAX_COLUMNS);
  });

  it("still sizes a page saved under a retired preset id", () => {
    expect(viewPageSize({ layoutId: "6-grid", slots: [] })).toBe(6);
    expect(viewPageSize({ layoutId: "3-main-right", slots: [] })).toBe(3);
  });
});

describe("resolveView", () => {
  it("climbs the 자동 ladder with the number of sessions on the page", () => {
    const ladder = [
      "cols:1",
      "cols:1-1",
      "cols:1-1-1",
      "cols:1-1-1-1",
      "cols:1-1-1-1-1",
      "cols:1-1-1-1-1-1",
    ];
    ladder.forEach((layoutId, index) => {
      const slots = Array.from({ length: index + 1 }, (_, slot) => `s${slot}`);
      const view = resolveView({ layoutId: "auto", slots }, 0);
      expect(view.layout.id).toBe(layoutId);
      expect(view.slots).toEqual(slots);
    });
  });

  it("gives a 자동 page of its own layout once sessions spill over", () => {
    const view = { layoutId: "auto", slots: ["a", "b", "c", "d", "e", "f", "g", "h"] };
    expect(resolveView(view, 0).layout.id).toBe("cols:1-1-1-1-1-1");
    const second = resolveView(view, 1);
    expect(second.layout.id).toBe("cols:1-1");
    expect(second.slots).toEqual(["g", "h"]);
    expect(second.pages).toBe(2);
  });

  it("draws one empty slot for a 자동 view holding nothing", () => {
    const view = resolveView({ layoutId: "auto", slots: [] }, 0);
    expect(view.layout.id).toBe("cols:1");
    expect(view.slots).toEqual([null]);
  });

  it("keeps a preset's empty slots as the drop targets they are", () => {
    const view = resolveView({ layoutId: "cols:2-2", slots: ["a", null, "c"] }, 0);
    expect(view.layout.id).toBe("cols:2-2");
    expect(view.slots).toEqual(["a", null, "c", null]);
  });

  it("clamps a page past the end back onto the last one", () => {
    const view = resolveView({ layoutId: "cols:1-2", slots: ["a", "b", "c", "d"] }, 9);
    expect(view.page).toBe(1);
    expect(view.pages).toBe(2);
    expect(view.slots).toEqual(["d", null, null]);
  });
});
