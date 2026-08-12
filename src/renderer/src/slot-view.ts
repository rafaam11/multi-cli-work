import type { SlotViewState } from "@shared/app-state-types";
import {
  DEFAULT_LAYOUT_ID,
  MAX_COLUMNS,
  MAX_LAYOUT_SLOTS,
  MAX_ROWS_PER_COLUMN,
  autoLayoutFor,
  buildLayout,
  columnOfSlot,
  defaultLayoutFor,
  isAutoLayout,
  layoutById,
  resolveLayout,
  type GridLayout,
} from "./grid-layouts";

/**
 * A view's slots as pure data. Everything the grid, the tab bar and the sidebar do to an
 * arrangement goes through one of these functions, so App only ever swaps one state object for
 * another and the rules stay testable without a DOM.
 *
 * The array is longer than one page whenever sessions spill over: slot index `n` sits on page
 * `floor(n / pageSize)`.
 *
 * Panes close up behind a departure. Removing a session, emptying a slot or losing a document
 * splices the entry out, so everything after it moves one slot forward and the grid never shows a
 * gap nobody asked for. A drop is the mirror image: the pane is spliced *in* at the slot it landed
 * on and whoever stood there moves back, rather than the two trading places.
 *
 * The one hole that survives comes from dropping past the end — the padding in front of that slot
 * is a position the user picked on purpose, so it is kept and only trailing holes are trimmed.
 *
 * A 자동 view holds no holes at all. Its layout follows the session count, so an empty slot would
 * only ever be a slot the layout was about to stop drawing.
 */

function trimTrailingHoles(slots: (string | null)[]): (string | null)[] {
  const next = [...slots];
  while (next.length > 0 && next[next.length - 1] === null) next.pop();
  return next;
}

/** A hole is a slot a drop reached past in a fixed layout, and meaningless in 자동. */
function tidySlots(layoutId: string, slots: (string | null)[]): (string | null)[] {
  if (isAutoLayout(layoutId)) return slots.filter((id): id is string => id !== null);
  return trimTrailingHoles(slots);
}

function firstHole(slots: readonly (string | null)[], except: number): number {
  return slots.findIndex((slot, index) => slot === null && index !== except);
}

/**
 * Closes up behind slots whose session is gone and repeats of a session already placed, leaving
 * the holes a drop put there alone. With `autoAppend`,
 * sessions the view does not list yet take the first open slot, then the end — that is how a
 * folder's grid fills itself. Callers turn it on at the moments a folder view should catch up
 * (opening it, a session being born) rather than on every render, so emptying a slot by hand is
 * not undone on the next paint.
 *
 * `keep` names panes that stay where they are but are never appended: the documents opened beside
 * a folder's terminals. A folder catching up on its sessions must not also pull in every file the
 * user happens to have open elsewhere.
 *
 * A view nobody has saved yet starts on 자동: that is v1.13's behaviour — every session on screen,
 * the arrangement following the count — kept as the default until someone picks a preset.
 */
export function normalizeSlots(
  view: SlotViewState | undefined,
  sessionIds: readonly string[],
  options: { autoAppend?: boolean; keep?: readonly string[] } = {},
): SlotViewState {
  const layoutId = view?.layoutId ?? DEFAULT_LAYOUT_ID;
  const known = new Set([...sessionIds, ...(options.keep ?? [])]);
  const placed = new Set<string>();
  const kept: (string | null)[] = [];
  for (const id of view?.slots ?? []) {
    // A hole stays where it is; a pane that is gone takes its slot with it.
    if (id === null) kept.push(null);
    else if (known.has(id) && !placed.has(id)) {
      placed.add(id);
      kept.push(id);
    }
  }
  const slots: (string | null)[] = tidySlots(layoutId, kept);
  if (options.autoAppend) {
    for (const id of sessionIds) {
      if (placed.has(id)) continue;
      placed.add(id);
      const hole = firstHole(slots, -1);
      if (hole >= 0) slots[hole] = id;
      else slots.push(id);
    }
  }
  return { layoutId, slots: tidySlots(layoutId, slots) };
}

/**
 * Moves a session into a slot by inserting it there: whoever held that slot, and everyone after
 * them, moves back one. A pane already in this view leaves its old slot first, so the panes
 * between the two ends shift by one rather than the two swapping. Nothing leaves the view unasked.
 *
 * Dropping past the last pane pads with holes and lands on the slot the user aimed at.
 */
export function placeInSlot(view: SlotViewState, index: number, sessionId: string): SlotViewState {
  if (index < 0) return view;
  const slots: (string | null)[] = [...view.slots];
  const from = slots.indexOf(sessionId);
  if (from === index) return view;
  if (from >= 0) slots.splice(from, 1);
  while (slots.length < index) slots.push(null);
  slots.splice(index, 0, sessionId);
  return { ...view, slots: tidySlots(view.layoutId, slots) };
}

/** Takes a pane off the grid without touching the session behind it; the rest move forward. */
export function clearSlot(view: SlotViewState, index: number): SlotViewState {
  if (index < 0 || index >= view.slots.length) return view;
  const slots = [...view.slots];
  slots.splice(index, 1);
  return { ...view, slots: tidySlots(view.layoutId, slots) };
}

/**
 * Adds a session to the first open slot, or to the end — a drop onto the 작업공간 row, and how the
 * workspace picks up a pane the app has just started holding. A hole a drop reached past counts as
 * free, so a shelf fills the gaps in front of it before it grows another page.
 */
export function appendSession(view: SlotViewState, sessionId: string): SlotViewState {
  if (view.slots.includes(sessionId)) return view;
  const slots: (string | null)[] = [...view.slots];
  const hole = firstHole(slots, -1);
  if (hole >= 0) slots[hole] = sessionId;
  else slots.push(sessionId);
  return { ...view, slots: tidySlots(view.layoutId, slots) };
}

/** Closes the grid up behind the session: the panes after it each move one slot forward. */
export function removeSession(view: SlotViewState, sessionId: string): SlotViewState {
  if (!view.slots.includes(sessionId)) return view;
  return {
    ...view,
    slots: tidySlots(
      view.layoutId,
      view.slots.filter((id) => id !== sessionId),
    ),
  };
}

/**
 * Swaps one pane id for another in place — a renamed file keeps its slot instead of vanishing and
 * reopening somewhere else. Only documents need this: a file tab's id is derived from its path.
 */
export function renamePaneId(view: SlotViewState, oldId: string, newId: string): SlotViewState {
  if (!view.slots.includes(oldId)) return view;
  return { ...view, slots: view.slots.map((id) => (id === oldId ? newId : id)) };
}

/** Switching to or from 자동 changes what a hole means, so the slots are tidied to the new rule. */
export function setLayout(view: SlotViewState, layoutId: string): SlotViewState {
  return { layoutId, slots: tidySlots(layoutId, [...view.slots]) };
}

/**
 * Splitting and merging are addressed the way the user sees them: the slot on the page they are
 * looking at. Both take the layout the grid is actually drawing rather than re-deriving it, because
 * a 자동 view's arrangement is a decision `resolveView` has already made — making it twice is how the
 * two would drift apart.
 *
 * A split on a 자동 view pins it to a fixed layout. 자동 means "one column per session", which has no
 * room for a stacked pair; asking for one is picking an arrangement by hand.
 */
/**
 * Where a slot on the page in front of the user sits in the flat array. The stride is the view's
 * page size and not the drawn layout's slot count: a 자동 page draws only as many columns as it has
 * panes, so its last page is narrower than the stride that got the user there.
 */
function absoluteSlotOf(view: SlotViewState, page: number, slotIndex: number): number {
  return Math.max(page, 0) * viewPageSize(view) + slotIndex;
}

/**
 * Gives this slot's column a second row, leaving every other column at full height. The new row
 * opens empty directly below the pane that asked for it, and the panes after it each move back one
 * slot — the same rule a drop follows.
 */
export function splitColumnAt(
  view: SlotViewState,
  layout: GridLayout,
  page: number,
  slotIndex: number,
): SlotViewState {
  const found = columnOfSlot(layout.columnRows, slotIndex);
  if (!found || found.rows >= MAX_ROWS_PER_COLUMN || layout.slots >= MAX_LAYOUT_SLOTS) return view;
  const columnRows = [...layout.columnRows];
  columnRows[found.column] = found.rows + 1;
  const next = buildLayout(columnRows);
  const at = absoluteSlotOf(view, page, found.start + found.rows);
  const slots: (string | null)[] = [...view.slots];
  while (slots.length < at) slots.push(null);
  slots.splice(at, 0, null);
  return { layoutId: next.id, slots: tidySlots(next.id, slots) };
}

/**
 * Puts this slot's column back to one full-height pane. The column's top pane is the one that
 * stays, whichever of the two the user pressed the button on. The lower pane leaves the grid the
 * way `clearSlot` takes one off — the entry is spliced out and the panes behind it move forward —
 * so it is off the arrangement but not closed: its session keeps running and its tab is still there
 * to drag back in.
 */
export function mergeColumnAt(
  view: SlotViewState,
  layout: GridLayout,
  page: number,
  slotIndex: number,
): SlotViewState {
  const found = columnOfSlot(layout.columnRows, slotIndex);
  if (!found || found.rows <= 1) return view;
  const columnRows = [...layout.columnRows];
  columnRows[found.column] = 1;
  const next = buildLayout(columnRows);
  const at = absoluteSlotOf(view, page, found.start + 1);
  const slots = [...view.slots];
  if (at < slots.length) slots.splice(at, found.rows - 1);
  return { layoutId: next.id, slots: tidySlots(next.id, slots) };
}

/**
 * How many slots one page holds. A preset says so itself; 자동 has no fixed answer, so it takes the
 * ceiling and lets the page's own session count choose the arrangement. That ceiling is the column
 * cap, not the slot cap — 자동 draws plain columns and never splits one, so it cannot reach twelve.
 */
export function viewPageSize(view: SlotViewState): number {
  if (isAutoLayout(view.layoutId)) return MAX_COLUMNS;
  const known = layoutById(view.layoutId);
  if (known) return known.slots;
  return defaultLayoutFor(view.slots.filter((id) => id !== null).length).slots;
}

/** At least one page, even when the view holds nothing — an empty grid still draws its slots. */
export function pageCount(slots: readonly (string | null)[], pageSize: number): number {
  return Math.max(1, Math.ceil(slots.length / Math.max(pageSize, 1)));
}

export function clampPage(page: number, pages: number): number {
  return Math.min(Math.max(page, 0), Math.max(pages - 1, 0));
}

/** Exactly `pageSize` entries — what one page of the grid draws, holes included. */
export function pageSlots(
  slots: readonly (string | null)[],
  pageSize: number,
  page: number,
): (string | null)[] {
  const size = Math.max(pageSize, 1);
  const start = clampPage(page, pageCount(slots, size)) * size;
  return Array.from({ length: size }, (_, index) => slots[start + index] ?? null);
}

/** Which page shows this session, or null when the view does not hold it. */
export function pageOfSession(
  slots: readonly (string | null)[],
  pageSize: number,
  sessionId: string,
): number | null {
  const index = slots.indexOf(sessionId);
  return index < 0 ? null : Math.floor(index / Math.max(pageSize, 1));
}

/** The sessions a page actually shows, in slot order — what main is told is on screen. */
export function visibleSessionsOf(
  slots: readonly (string | null)[],
  pageSize: number,
  page: number,
): string[] {
  return pageSlots(slots, pageSize, page).filter((id): id is string => id !== null);
}

export interface ResolvedView {
  /** The grid to draw: the chosen preset, or 자동's pick for this page's session count. */
  layout: GridLayout;
  /** Exactly `layout.slots` entries, in slot order. */
  slots: (string | null)[];
  page: number;
  pages: number;
}

/**
 * Everything the grid needs for one page of a view. This is the only place that knows 자동 differs
 * from a preset, so the grid, the tab bar and the visible-session report all read the same answer.
 */
export function resolveView(view: SlotViewState, page: number): ResolvedView {
  const size = viewPageSize(view);
  const pages = pageCount(view.slots, size);
  const current = clampPage(page, pages);
  const cells = pageSlots(view.slots, size, current);
  const auto = isAutoLayout(view.layoutId);
  const source = auto ? cells.filter((id): id is string => id !== null) : cells;
  const layout = auto ? autoLayoutFor(source.length) : resolveLayout(view.layoutId, size);
  return {
    layout,
    slots: Array.from({ length: layout.slots }, (_, index) => source[index] ?? null),
    page: current,
    pages,
  };
}
