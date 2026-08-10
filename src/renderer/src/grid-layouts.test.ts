import { describe, expect, it } from "vitest";
import {
  AUTO_LAYOUT_ID,
  DEFAULT_LAYOUT_ID,
  GRID_LAYOUTS,
  MAX_LAYOUT_SLOTS,
  autoLayoutFor,
  defaultLayoutFor,
  isAutoLayout,
  layoutAreaNames,
  layoutById,
  layoutGroups,
  resolveLayout,
} from "./grid-layouts";

describe("GRID_LAYOUTS", () => {
  it("gives every layout a unique id", () => {
    expect(new Set(GRID_LAYOUTS.map((layout) => layout.id)).size).toBe(GRID_LAYOUTS.length);
  });

  it("places exactly the slots it claims, numbered from 1 with no gaps", () => {
    for (const layout of GRID_LAYOUTS) {
      const placed = new Set(layoutAreaNames(layout));
      const expected = new Set(Array.from({ length: layout.slots }, (_, index) => `s${index + 1}`));
      expect({ id: layout.id, placed }).toEqual({ id: layout.id, placed: expected });
    }
  });

  it("keeps every row of a layout the same width as its column track list", () => {
    for (const layout of GRID_LAYOUTS) {
      const columns = layout.columns.split(/\s+/).length;
      const rows = layout.areas.match(/"[^"]*"/g) ?? [];
      expect({ id: layout.id, rows: rows.length }).toEqual({ id: layout.id, rows: layout.rows.split(/\s+/).length });
      for (const row of rows) {
        expect({ id: layout.id, row, cells: row.slice(1, -1).trim().split(/\s+/).length }).toEqual({
          id: layout.id,
          row,
          cells: columns,
        });
      }
    }
  });

  it("keeps every area rectangular, which is what CSS grid accepts", () => {
    for (const layout of GRID_LAYOUTS) {
      const rows = (layout.areas.match(/"[^"]*"/g) ?? []).map((row) => row.slice(1, -1).trim().split(/\s+/));
      for (const area of new Set(rows.flat())) {
        const cells = rows.flatMap((row, y) => row.map((name, x) => ({ name, x, y }))).filter((cell) => cell.name === area);
        const xs = cells.map((cell) => cell.x);
        const ys = cells.map((cell) => cell.y);
        const width = Math.max(...xs) - Math.min(...xs) + 1;
        const height = Math.max(...ys) - Math.min(...ys) + 1;
        expect({ id: layout.id, area, cells: cells.length }).toEqual({ id: layout.id, area, cells: width * height });
      }
    }
  });

  it("covers every slot count from 1 to the maximum", () => {
    expect(new Set(GRID_LAYOUTS.map((layout) => layout.slots))).toEqual(
      new Set(Array.from({ length: MAX_LAYOUT_SLOTS }, (_, index) => index + 1)),
    );
  });

  it("never offers more slots than a page can hold", () => {
    for (const layout of GRID_LAYOUTS) expect(layout.slots).toBeLessThanOrEqual(MAX_LAYOUT_SLOTS);
  });
});

describe("defaultLayoutFor", () => {
  it("picks the first layout of that slot count", () => {
    expect(defaultLayoutFor(1).id).toBe("solo");
    expect(defaultLayoutFor(2).id).toBe("2-col");
    expect(defaultLayoutFor(3).id).toBe("3-main-right");
    expect(defaultLayoutFor(4).id).toBe("4-quad");
    expect(defaultLayoutFor(5).id).toBe("5-main-quad");
    expect(defaultLayoutFor(6).id).toBe("6-grid");
  });

  it("clamps counts that no layout can serve", () => {
    expect(defaultLayoutFor(0).id).toBe("solo");
    expect(defaultLayoutFor(-3).id).toBe("solo");
    expect(defaultLayoutFor(99).id).toBe("6-grid");
  });
});

describe("autoLayoutFor", () => {
  it("follows the ladder the user asked for: one, two across, three columns, then splits from the right", () => {
    expect(autoLayoutFor(1).id).toBe("solo");
    expect(autoLayoutFor(2).id).toBe("2-col");
    expect(autoLayoutFor(3).id).toBe("3-col");
    expect(autoLayoutFor(4).id).toBe("4-thirds-right");
    expect(autoLayoutFor(5).id).toBe("5-thirds-split");
    expect(autoLayoutFor(6).id).toBe("6-grid");
  });

  it("keeps the split layouts on three columns, so the panes line up as the count grows", () => {
    for (const count of [3, 4, 5, 6]) expect(autoLayoutFor(count).columns).toBe("1fr 1fr 1fr");
  });

  it("clamps a count no layout can serve instead of coming back empty", () => {
    expect(autoLayoutFor(0).id).toBe("solo");
    expect(autoLayoutFor(-1).id).toBe("solo");
    expect(autoLayoutFor(99).id).toBe("6-grid");
  });

  it("names layouts the catalog actually has", () => {
    for (let count = 1; count <= MAX_LAYOUT_SLOTS; count += 1) {
      const layout = autoLayoutFor(count);
      expect(layoutById(layout.id)).toBe(layout);
      expect(layout.slots).toBe(count);
    }
  });

  it("is not itself a catalog entry — 자동 is an instruction, not a preset", () => {
    expect(layoutById(AUTO_LAYOUT_ID)).toBeNull();
    expect(isAutoLayout(AUTO_LAYOUT_ID)).toBe(true);
    expect(isAutoLayout("6-grid")).toBe(false);
    expect(isAutoLayout(null)).toBe(false);
  });
});

describe("resolveLayout", () => {
  it("returns the stored layout when the catalog still has it", () => {
    expect(resolveLayout("6-row-pairs", 2).id).toBe("6-row-pairs");
  });

  it("reads 자동 as the ladder entry for the count it is handed", () => {
    expect(resolveLayout(AUTO_LAYOUT_ID, 4).id).toBe("4-thirds-right");
    expect(resolveLayout(AUTO_LAYOUT_ID, 1).id).toBe("solo");
  });

  it("falls back on the session count when the stored id is gone", () => {
    expect(resolveLayout("layout-from-a-future-version", 4).id).toBe("4-quad");
    expect(resolveLayout(null).id).toBe("solo");
    expect(resolveLayout(undefined).id).toBe("solo");
  });

  it("starts a fresh view on 자동", () => {
    expect(DEFAULT_LAYOUT_ID).toBe(AUTO_LAYOUT_ID);
  });
});

describe("layoutById", () => {
  it("returns null rather than a guess for an unknown id", () => {
    expect(layoutById("nope")).toBeNull();
  });
});

describe("layoutGroups", () => {
  it("groups the catalog by slot count in ascending order without dropping anything", () => {
    const groups = layoutGroups();
    expect(groups.map((group) => group.slots)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(groups.flatMap((group) => group.layouts)).toEqual([...GRID_LAYOUTS]);
  });
});
