import { describe, expect, it } from "vitest";
import {
  AUTO_LAYOUT_ID,
  AUTO_LAYOUT_IDS,
  DEFAULT_LAYOUT_ID,
  GRID_LAYOUTS,
  MAX_COLUMNS,
  MAX_LAYOUT_SLOTS,
  MAX_ROWS_PER_COLUMN,
  autoLayoutFor,
  buildLayout,
  canSplitColumn,
  columnOfSlot,
  defaultLayoutFor,
  isAutoLayout,
  isValidColumnRows,
  layoutAreaNames,
  layoutById,
  parseLayoutId,
  resolveLayout,
} from "./grid-layouts";

/**
 * Every arrangement the model can express — one to six columns, each either whole or split. The
 * generator is what the app trusts now, so the structural rules are checked against all 126 of
 * them rather than against a hand-written catalog.
 */
function everyColumnRows(): number[][] {
  const all: number[][] = [];
  for (let columns = 1; columns <= MAX_COLUMNS; columns += 1) {
    for (let mask = 0; mask < 2 ** columns; mask += 1) {
      all.push(Array.from({ length: columns }, (_, index) => ((mask >> index) & 1) + 1));
    }
  }
  return all;
}

const ALL_LAYOUTS = everyColumnRows().map(buildLayout);

describe("buildLayout", () => {
  it("places exactly the slots it claims, numbered from 1 with no gaps", () => {
    for (const layout of ALL_LAYOUTS) {
      const placed = new Set(layoutAreaNames(layout));
      const expected = new Set(Array.from({ length: layout.slots }, (_, index) => `s${index + 1}`));
      expect({ id: layout.id, placed }).toEqual({ id: layout.id, placed: expected });
    }
  });

  it("keeps every row of a layout the same width as its column track list", () => {
    for (const layout of ALL_LAYOUTS) {
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
    for (const layout of ALL_LAYOUTS) {
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

  it("numbers slots column first, so a split only renumbers what is to its right", () => {
    expect(buildLayout([1, 2, 1]).areas).toBe('"s1 s2 s4" "s1 s3 s4"');
    expect(buildLayout([2, 2]).areas).toBe('"s1 s3" "s2 s4"');
    expect(buildLayout([1, 1, 1]).areas).toBe('"s1 s2 s3"');
  });

  it("gives an unsplit column the full height and equal width to its neighbours", () => {
    expect(buildLayout([1, 2, 1]).rows).toBe("1fr 1fr");
    expect(buildLayout([1, 2, 1]).columns).toBe("1fr 1fr 1fr");
    // s1 and s4 each appear in both rows, which is the span.
    expect(buildLayout([1, 2, 1]).areas.match(/s1/g)).toHaveLength(2);
    expect(buildLayout([1, 2, 1]).areas.match(/s4/g)).toHaveLength(2);
  });

  it("draws a single grid row while nothing is split", () => {
    for (let columns = 1; columns <= MAX_COLUMNS; columns += 1) {
      expect(buildLayout(Array.from({ length: columns }, () => 1)).rows).toBe("1fr");
    }
  });

  it("names itself so the id round-trips through parseLayoutId", () => {
    for (const layout of ALL_LAYOUTS) {
      expect({ id: layout.id, parsed: parseLayoutId(layout.id) }).toEqual({
        id: layout.id,
        parsed: [...layout.columnRows],
      });
    }
  });

  it("never offers more slots than a page can hold", () => {
    for (const layout of ALL_LAYOUTS) expect(layout.slots).toBeLessThanOrEqual(MAX_LAYOUT_SLOTS);
    expect(buildLayout(Array.from({ length: MAX_COLUMNS }, () => MAX_ROWS_PER_COLUMN)).slots).toBe(MAX_LAYOUT_SLOTS);
  });

  it("labels plain columns by their count and says how many are split when any is", () => {
    expect(buildLayout([1]).label).toBe("1열");
    expect(buildLayout([1, 1, 1]).label).toBe("3열");
    expect(buildLayout([1, 2, 1]).label).toBe("3열 · 1분할");
    expect(buildLayout([2, 2, 2]).label).toBe("3열 · 3분할");
  });
});

describe("GRID_LAYOUTS", () => {
  /**
   * The picker is one flat row, so the catalog is also the list of tiles the user reads. It holds
   * only whole columns — splitting is a per-column button on the pane, not a sixty-four-tile row.
   */
  it("offers one column through six, none of them split", () => {
    expect(GRID_LAYOUTS.map((layout) => layout.id)).toEqual([
      "cols:1",
      "cols:1-1",
      "cols:1-1-1",
      "cols:1-1-1-1",
      "cols:1-1-1-1-1",
      "cols:1-1-1-1-1-1",
    ]);
    for (const layout of GRID_LAYOUTS) expect(layout.rows).toBe("1fr");
  });

  it("gives every layout a unique id", () => {
    expect(new Set(GRID_LAYOUTS.map((layout) => layout.id)).size).toBe(GRID_LAYOUTS.length);
    expect(new Set(ALL_LAYOUTS.map((layout) => layout.id)).size).toBe(ALL_LAYOUTS.length);
  });

  it("covers every column count from one to the maximum, one slot each", () => {
    expect(GRID_LAYOUTS.map((layout) => layout.slots)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("isValidColumnRows / parseLayoutId", () => {
  it("refuses shapes the grid has no room for", () => {
    expect(isValidColumnRows([])).toBe(false);
    expect(isValidColumnRows(Array.from({ length: MAX_COLUMNS + 1 }, () => 1))).toBe(false);
    expect(isValidColumnRows([0])).toBe(false);
    expect(isValidColumnRows([MAX_ROWS_PER_COLUMN + 1])).toBe(false);
    expect(isValidColumnRows([1.5])).toBe(false);
  });

  /** The two caps together bound the slot count, so no separate sum check can be reached. */
  it("bounds the slot count through the column and row caps alone", () => {
    for (const layout of ALL_LAYOUTS) expect(layout.slots).toBeLessThanOrEqual(MAX_COLUMNS * MAX_ROWS_PER_COLUMN);
  });

  it("rejects anything that is not one of our ids", () => {
    expect(parseLayoutId("cols:")).toBeNull();
    expect(parseLayoutId("cols:1-1-1-1-1-1-1")).toBeNull();
    expect(parseLayoutId("cols:3")).toBeNull();
    expect(parseLayoutId("cols:0")).toBeNull();
    expect(parseLayoutId("cols:a")).toBeNull();
    expect(parseLayoutId("cols:1--1")).toBeNull();
    expect(parseLayoutId("4-quad")).toBeNull();
    expect(parseLayoutId(null)).toBeNull();
    expect(parseLayoutId(undefined)).toBeNull();
  });
});

describe("layoutById", () => {
  it("reads the ids saved before layouts became arrays", () => {
    const legacy: Record<string, number[]> = {
      solo: [1],
      "2-col": [1, 1],
      "3-col": [1, 1, 1],
      "3-main-right": [1, 2],
      "4-quad": [2, 2],
      "4-thirds-right": [1, 1, 2],
      "5-main-quad": [1, 2, 2],
      "6-grid": [2, 2, 2],
    };
    for (const [id, columnRows] of Object.entries(legacy)) {
      expect({ id, layout: layoutById(id) }).toEqual({ id, layout: buildLayout(columnRows) });
    }
  });

  it("returns null rather than a guess for an unknown id", () => {
    expect(layoutById("nope")).toBeNull();
    expect(layoutById("cols:9")).toBeNull();
    expect(layoutById(null)).toBeNull();
  });
});

describe("defaultLayoutFor", () => {
  it("gives that many plain columns", () => {
    expect(defaultLayoutFor(1).id).toBe("cols:1");
    expect(defaultLayoutFor(3).id).toBe("cols:1-1-1");
    expect(defaultLayoutFor(6).id).toBe("cols:1-1-1-1-1-1");
  });

  it("clamps counts no arrangement can serve", () => {
    expect(defaultLayoutFor(0).id).toBe("cols:1");
    expect(defaultLayoutFor(-3).id).toBe("cols:1");
    expect(defaultLayoutFor(99).id).toBe("cols:1-1-1-1-1-1");
  });
});

describe("autoLayoutFor", () => {
  it("climbs one column per session and never stacks a pane", () => {
    for (let count = 1; count <= MAX_COLUMNS; count += 1) {
      const layout = autoLayoutFor(count);
      expect({ count, columnRows: [...layout.columnRows] }).toEqual({
        count,
        columnRows: Array.from({ length: count }, () => 1),
      });
      expect(layout.rows).toBe("1fr");
      expect(layout.slots).toBe(count);
    }
  });

  it("is the same ladder the picker draws", () => {
    expect(AUTO_LAYOUT_IDS).toEqual(GRID_LAYOUTS.map((layout) => layout.id));
    expect(AUTO_LAYOUT_IDS).toHaveLength(MAX_COLUMNS);
  });

  it("clamps a count no arrangement can serve instead of coming back empty", () => {
    expect(autoLayoutFor(0).id).toBe("cols:1");
    expect(autoLayoutFor(-1).id).toBe("cols:1");
    expect(autoLayoutFor(99).id).toBe("cols:1-1-1-1-1-1");
  });

  it("names layouts the model can read back", () => {
    for (let count = 1; count <= MAX_COLUMNS; count += 1) {
      const layout = autoLayoutFor(count);
      expect(layoutById(layout.id)).toEqual(layout);
    }
  });

  it("is not itself a stored arrangement — 자동 is an instruction, not a preset", () => {
    expect(layoutById(AUTO_LAYOUT_ID)).toBeNull();
    expect(isAutoLayout(AUTO_LAYOUT_ID)).toBe(true);
    expect(isAutoLayout("cols:1-1-1")).toBe(false);
    expect(isAutoLayout(null)).toBe(false);
  });
});

describe("resolveLayout", () => {
  it("returns the stored layout when it can be read", () => {
    expect(resolveLayout("cols:1-2-1", 2).id).toBe("cols:1-2-1");
  });

  /** A view saved on a retired preset opens on the arrangement it meant, not blank. */
  it("keeps a view saved by an older build", () => {
    expect(resolveLayout("6-grid", 2).id).toBe("cols:2-2-2");
    expect(resolveLayout("4-quad", 4).id).toBe("cols:2-2");
  });

  it("reads 자동 as the ladder entry for the count it is handed", () => {
    expect(resolveLayout(AUTO_LAYOUT_ID, 4).id).toBe("cols:1-1-1-1");
    expect(resolveLayout(AUTO_LAYOUT_ID, 1).id).toBe("cols:1");
  });

  it("falls back on the session count when the stored id cannot be read", () => {
    expect(resolveLayout("layout-from-a-future-version", 4).id).toBe("cols:1-1-1-1");
    expect(resolveLayout("2-row", 2).id).toBe("cols:1-1");
    expect(resolveLayout(null).id).toBe("cols:1");
    expect(resolveLayout(undefined).id).toBe("cols:1");
  });

  it("starts a fresh view on 자동", () => {
    expect(DEFAULT_LAYOUT_ID).toBe(AUTO_LAYOUT_ID);
  });
});

describe("columnOfSlot", () => {
  it("names the column a slot belongs to and where that column starts", () => {
    const columnRows = [1, 2, 1];
    expect(columnOfSlot(columnRows, 0)).toEqual({ column: 0, start: 0, rows: 1 });
    expect(columnOfSlot(columnRows, 1)).toEqual({ column: 1, start: 1, rows: 2 });
    expect(columnOfSlot(columnRows, 2)).toEqual({ column: 1, start: 1, rows: 2 });
    expect(columnOfSlot(columnRows, 3)).toEqual({ column: 2, start: 3, rows: 1 });
  });

  it("returns null for a slot no column holds", () => {
    expect(columnOfSlot([1, 2, 1], 4)).toBeNull();
    expect(columnOfSlot([1, 2, 1], -1)).toBeNull();
    expect(columnOfSlot([], 0)).toBeNull();
  });
});

describe("canSplitColumn", () => {
  it("allows a whole column to split and refuses one that already has", () => {
    const layout = buildLayout([1, 2, 1]);
    expect(canSplitColumn(layout, 0)).toBe(true);
    expect(canSplitColumn(layout, 1)).toBe(false);
    expect(canSplitColumn(layout, 2)).toBe(false);
    expect(canSplitColumn(layout, 3)).toBe(true);
  });

  it("refuses a slot the layout does not draw", () => {
    expect(canSplitColumn(buildLayout([1, 1]), 2)).toBe(false);
  });

  it("refuses every column once the page is full", () => {
    const full = buildLayout(Array.from({ length: MAX_COLUMNS }, () => MAX_ROWS_PER_COLUMN));
    expect(full.slots).toBe(MAX_LAYOUT_SLOTS);
    for (let slot = 0; slot < full.slots; slot += 1) expect(canSplitColumn(full, slot)).toBe(false);
  });
});
