/**
 * Every layout the workspace grid can take. One table drives both the real grid and the picker's
 * previews: the picker draws numbered tiles with the same `grid-template-*` values the grid uses,
 * so what the popup shows is what the panes do.
 *
 * A layout decides how many slots exist — the session count no longer does. Slot i lives in
 * `grid-area: s{i}`, counted from 1 so the picker can print the same number the user reads.
 */
export interface GridLayout {
  id: string;
  /** How many panes fit. Sessions beyond this spill onto the next page. */
  slots: number;
  /** Short Korean name, shown under the preview tile. The slot count is rendered separately. */
  label: string;
  columns: string;
  rows: string;
  areas: string;
}

/** No layout has more slots than this, so a page never holds more than six live terminals. */
export const MAX_LAYOUT_SLOTS = 6;

/**
 * Ordered by slot count, and within a count the first entry is the default. The defaults follow
 * the left-is-main habit the user works by: one fills the view, two split left/right, three
 * put a main pane beside a stacked pair, four take a 2×2, five keep a tall main beside a 2×2,
 * six use 3×2.
 */
export const GRID_LAYOUTS: readonly GridLayout[] = [
  {
    id: "solo",
    slots: 1,
    label: "전체",
    columns: "1fr",
    rows: "1fr",
    areas: '"s1"',
  },
  {
    id: "2-col",
    slots: 2,
    label: "좌우",
    columns: "1fr 1fr",
    rows: "1fr",
    areas: '"s1 s2"',
  },
  {
    id: "2-row",
    slots: 2,
    label: "상하",
    columns: "1fr",
    rows: "1fr 1fr",
    areas: '"s1" "s2"',
  },
  {
    id: "3-main-right",
    slots: 3,
    label: "메인 + 우측 2",
    columns: "1.3fr 1fr",
    rows: "1fr 1fr",
    areas: '"s1 s2" "s1 s3"',
  },
  {
    id: "3-col",
    slots: 3,
    label: "3열",
    columns: "1fr 1fr 1fr",
    rows: "1fr",
    areas: '"s1 s2 s3"',
  },
  {
    id: "3-top-main",
    slots: 3,
    label: "상단 메인 + 하단 2",
    columns: "1fr 1fr",
    rows: "1.3fr 1fr",
    areas: '"s1 s1" "s2 s3"',
  },
  {
    id: "4-quad",
    slots: 4,
    label: "2×2",
    columns: "1fr 1fr",
    rows: "1fr 1fr",
    areas: '"s1 s2" "s3 s4"',
  },
  {
    id: "4-thirds-right",
    slots: 4,
    label: "3열 + 우측 2분할",
    columns: "1fr 1fr 1fr",
    rows: "1fr 1fr",
    areas: '"s1 s2 s3" "s1 s2 s4"',
  },
  {
    id: "4-main-right",
    slots: 4,
    label: "메인 + 우측 3",
    columns: "1.4fr 1fr",
    rows: "1fr 1fr 1fr",
    areas: '"s1 s2" "s1 s3" "s1 s4"',
  },
  {
    id: "4-col",
    slots: 4,
    label: "4열",
    columns: "1fr 1fr 1fr 1fr",
    rows: "1fr",
    areas: '"s1 s2 s3 s4"',
  },
  {
    id: "5-main-quad",
    slots: 5,
    label: "메인 + 우측 2×2",
    columns: "1.4fr 1fr 1fr",
    rows: "1fr 1fr",
    areas: '"s1 s2 s3" "s1 s4 s5"',
  },
  {
    id: "5-thirds-split",
    slots: 5,
    label: "3열 + 가운데·우측 2분할",
    columns: "1fr 1fr 1fr",
    rows: "1fr 1fr",
    areas: '"s1 s2 s3" "s1 s4 s5"',
  },
  {
    id: "5-wide-last",
    slots: 5,
    label: "3열 + 하단 넓게",
    columns: "1fr 1fr 1fr",
    rows: "1fr 1fr",
    areas: '"s1 s2 s3" "s4 s5 s5"',
  },
  {
    id: "6-grid",
    slots: 6,
    label: "3×2",
    columns: "1fr 1fr 1fr",
    rows: "1fr 1fr",
    areas: '"s1 s2 s3" "s4 s5 s6"',
  },
  {
    id: "6-row-pairs",
    slots: 6,
    label: "2×3",
    columns: "1fr 1fr",
    rows: "1fr 1fr 1fr",
    areas: '"s1 s2" "s3 s4" "s5 s6"',
  },
];

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

/** The ladder 자동 climbs: one fills the view, then columns, then columns that split from the right. */
const AUTO_LAYOUT_IDS = ["solo", "2-col", "3-col", "4-thirds-right", "5-thirds-split", "6-grid"] as const;

export function autoLayoutFor(sessionCount: number): GridLayout {
  const clamped = Math.min(Math.max(Math.round(sessionCount) || 0, 1), MAX_LAYOUT_SLOTS);
  return layoutById(AUTO_LAYOUT_IDS[clamped - 1]) ?? GRID_LAYOUTS[0];
}

export function layoutById(id: string | null | undefined): GridLayout | null {
  return GRID_LAYOUTS.find((layout) => layout.id === id) ?? null;
}

/** The first layout of that slot count — what a view gets before anyone opens the picker. */
export function defaultLayoutFor(slots: number): GridLayout {
  const wanted = Math.min(Math.max(Math.round(slots) || 1, 1), MAX_LAYOUT_SLOTS);
  return GRID_LAYOUTS.find((layout) => layout.slots === wanted) ?? GRID_LAYOUTS[0];
}

/**
 * The grid a stored id asks for, given how many sessions the page holds. 자동 reads the count and
 * picks off the ladder; a stored id can also outlive the catalog entry that named it — an old state
 * file, a renamed preset — and falling back on the count keeps the view usable instead of blank.
 */
export function resolveLayout(id: string | null | undefined, sessionCount = 1): GridLayout {
  if (isAutoLayout(id)) return autoLayoutFor(sessionCount);
  return layoutById(id) ?? defaultLayoutFor(sessionCount);
}

/** Layouts grouped by slot count, in catalog order — the picker's sections. */
export function layoutGroups(): { slots: number; layouts: GridLayout[] }[] {
  const groups: { slots: number; layouts: GridLayout[] }[] = [];
  for (const layout of GRID_LAYOUTS) {
    const group = groups.find((entry) => entry.slots === layout.slots);
    if (group) group.layouts.push(layout);
    else groups.push({ slots: layout.slots, layouts: [layout] });
  }
  return groups;
}

/** The area names a layout actually places, in the order the rows read. */
export function layoutAreaNames(layout: GridLayout): string[] {
  return layout.areas.match(/s\d+/g) ?? [];
}
