/**
 * Every layout the workspace grid can take, generated rather than catalogued.
 *
 * A terminal's information runs downward, so height is the thing the grid must not spend. The base
 * arrangement is therefore always a row of columns — one to six of them, each a full-height strip —
 * and stacking is never something the whole grid does. It is something *one column* does, on
 * request, when that column happens to hold two things worth seeing at once.
 *
 * That makes a layout an array: how many rows each column holds, left to right.
 *
 *     [1]        one column
 *     [1,1,1]    three columns
 *     [1,2,1]    three columns, only the middle one split
 *     [2,2,2]    three columns, all split — six panes
 *
 * Six columns of two rows is the ceiling, so a page never holds more than twelve panes.
 *
 * `grid-template-*` is derived from that array, and the picker draws its previews from the same
 * values the grid uses, so what the tile shows is what the panes do. Slots are numbered column
 * first — `[1,2,1]` reads s1 | s2/s3 | s4 — because splitting a column then renumbers only the
 * slots to its right. Numbering by row would scramble every pane's slot on a single split.
 */
export interface GridLayout {
  id: string;
  /** How many rows each column holds, left to right. Its length is the column count. */
  columnRows: readonly number[];
  /** How many panes fit. Sessions beyond this spill onto the next page. */
  slots: number;
  /** Short Korean name, shown on the folder start page. The picker labels its tiles itself. */
  label: string;
  columns: string;
  rows: string;
  areas: string;
}

/** Six full-height strips is as narrow as a terminal column is worth making. */
export const MAX_COLUMNS = 6;

/**
 * A column splits once and no further. Halving a terminal already costs it the scarcest thing it
 * has; a third would leave too little scrollback for the pane to be worth looking at.
 */
export const MAX_ROWS_PER_COLUMN = 2;

/** No layout has more slots than this, and the two caps above are what make it so. */
export const MAX_LAYOUT_SLOTS = MAX_COLUMNS * MAX_ROWS_PER_COLUMN;

const LAYOUT_ID_PREFIX = "cols:";

function pureColumns(count: number): number[] {
  return Array.from({ length: count }, () => 1);
}

export function isValidColumnRows(columnRows: readonly number[]): boolean {
  if (columnRows.length < 1 || columnRows.length > MAX_COLUMNS) return false;
  return columnRows.every((rows) => Number.isInteger(rows) && rows >= 1 && rows <= MAX_ROWS_PER_COLUMN);
}

/**
 * The layout an array of column heights describes. Every id the app stores has this shape —
 * `cols:1-2-1` — including the unsplit ones, so there is one encoding and not two.
 */
export function buildLayout(columnRows: readonly number[]): GridLayout {
  const height = Math.max(...columnRows);
  const starts: number[] = [];
  let slots = 0;
  for (const rows of columnRows) {
    starts.push(slots);
    slots += rows;
  }
  // An unsplit column repeats its own area name down every grid row, which is how it spans the
  // full height and still leaves the grid rectangular.
  const areas = Array.from({ length: height }, (_, row) =>
    `"${columnRows.map((rows, column) => `s${starts[column] + (rows === 1 ? 0 : row) + 1}`).join(" ")}"`,
  ).join(" ");
  const split = columnRows.filter((rows) => rows > 1).length;
  return {
    id: `${LAYOUT_ID_PREFIX}${columnRows.join("-")}`,
    columnRows: [...columnRows],
    slots,
    label: split === 0 ? `${columnRows.length}열` : `${columnRows.length}열 · ${split}분할`,
    columns: Array.from({ length: columnRows.length }, () => "1fr").join(" "),
    rows: Array.from({ length: height }, () => "1fr").join(" "),
    areas,
  };
}

/** The column heights an id names, or null when it is not one of ours or breaks the caps. */
export function parseLayoutId(id: string | null | undefined): number[] | null {
  if (typeof id !== "string" || !id.startsWith(LAYOUT_ID_PREFIX)) return null;
  const body = id.slice(LAYOUT_ID_PREFIX.length);
  if (body.length === 0) return null;
  const columnRows = body.split("-").map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  return isValidColumnRows(columnRows) ? columnRows : null;
}

/**
 * The preset ids saved before layouts became arrays. A state file written by an older build still
 * opens on the arrangement it meant, rather than falling back on the pane count. `3-main-right`,
 * `4-thirds-right` and `5-main-quad` also gave their first column extra width; equal columns are
 * the closest this model has, and the difference is not worth an exception in the generator.
 */
const LEGACY_LAYOUT_IDS: Readonly<Record<string, readonly number[]>> = {
  solo: [1],
  "2-col": [1, 1],
  "3-col": [1, 1, 1],
  "3-main-right": [1, 2],
  "4-quad": [2, 2],
  "4-thirds-right": [1, 1, 2],
  "5-main-quad": [1, 2, 2],
  "6-grid": [2, 2, 2],
};

/**
 * What the picker offers: one column through six, none of them split. Splitting is a per-column
 * decision made on the pane itself, so it has no tile here — a row of sixty-four tiles would be
 * a worse way to say the same thing.
 */
export const GRID_LAYOUTS: readonly GridLayout[] = Array.from({ length: MAX_COLUMNS }, (_, index) =>
  buildLayout(pureColumns(index + 1)),
);

/**
 * 자동 is not a layout of its own but a standing instruction: draw whichever preset fits the number
 * of sessions the page holds right now. A view set to it never keeps an empty slot — panes
 * rearrange as sessions arrive and leave, which is what most folders want.
 */
export const AUTO_LAYOUT_ID = "auto";

export function isAutoLayout(layoutId: string | null | undefined): boolean {
  return layoutId === AUTO_LAYOUT_ID;
}

/** What a view nobody has arranged yet starts on. */
export const DEFAULT_LAYOUT_ID = AUTO_LAYOUT_ID;

/** The ladder 자동 climbs: one column per session, never a stacked row. */
export const AUTO_LAYOUT_IDS: readonly string[] = GRID_LAYOUTS.map((layout) => layout.id);

export function autoLayoutFor(sessionCount: number): GridLayout {
  const clamped = Math.min(Math.max(Math.round(sessionCount) || 0, 1), MAX_COLUMNS);
  return buildLayout(pureColumns(clamped));
}

export function layoutById(id: string | null | undefined): GridLayout | null {
  if (typeof id !== "string") return null;
  const legacy = LEGACY_LAYOUT_IDS[id];
  if (legacy) return buildLayout(legacy);
  const parsed = parseLayoutId(id);
  return parsed ? buildLayout(parsed) : null;
}

/** That many plain columns — what a view gets before anyone picks an arrangement. */
export function defaultLayoutFor(slots: number): GridLayout {
  const wanted = Math.min(Math.max(Math.round(slots) || 1, 1), MAX_COLUMNS);
  return buildLayout(pureColumns(wanted));
}

/**
 * The grid a stored id asks for, given how many sessions the page holds. 자동 reads the count and
 * picks off the ladder; a stored id can also be one this build cannot read — a state file from a
 * later version, a typo — and falling back on the count keeps the view usable instead of blank.
 */
export function resolveLayout(id: string | null | undefined, sessionCount = 1): GridLayout {
  if (isAutoLayout(id)) return autoLayoutFor(sessionCount);
  return layoutById(id) ?? defaultLayoutFor(sessionCount);
}

/** The area names a layout actually places, in the order the rows read. */
export function layoutAreaNames(layout: GridLayout): string[] {
  return layout.areas.match(/s\d+/g) ?? [];
}

/** Where a slot sits: which column owns it, that column's first slot, and how tall it is. */
export interface SlotColumn {
  column: number;
  start: number;
  rows: number;
}

export function columnOfSlot(columnRows: readonly number[], slotIndex: number): SlotColumn | null {
  if (!Number.isInteger(slotIndex) || slotIndex < 0) return null;
  let start = 0;
  for (let column = 0; column < columnRows.length; column += 1) {
    const rows = columnRows[column];
    if (slotIndex < start + rows) return { column, start, rows };
    start += rows;
  }
  return null;
}

/** Whether the pane in this slot can still split its column. Drives the header button's state. */
export function canSplitColumn(layout: GridLayout, slotIndex: number): boolean {
  const found = columnOfSlot(layout.columnRows, slotIndex);
  return found !== null && found.rows < MAX_ROWS_PER_COLUMN && layout.slots < MAX_LAYOUT_SLOTS;
}
