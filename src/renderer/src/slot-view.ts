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
import type { DropPosition } from "./project-order";

/**
 * A view's slots as pure data. Everything the grid, the tab bar and the sidebar do to an
 * arrangement goes through one of these functions, so App only ever swaps one state object for
 * another and the rules stay testable without a DOM.
 *
 * The array is longer than one page whenever sessions spill over: slot index `n` sits on page
 * `floor(n / pageSize)`.
 *
 * Slot numbers do not know about columns, so taking one entry out of the array moves every pane
 * after it across a column boundary. A view with a split column therefore never does that when a
 * pane leaves: the slot just goes empty. A view with no split has nothing to break, so its panes
 * close up behind a departure as they always did.
 *
 * A drop touches the slots it names and nothing else. An empty slot is filled, an occupied one is
 * traded for the slot the pane came from, and a pane arriving from outside the view sends whoever
 * stood there to the first open slot.
 *
 * Trailing holes are always trimmed. A 자동 view holds no holes at all: its layout follows the
 * session count, so an empty slot would only ever be a slot the layout was about to stop drawing.
 */

/** Auto and a layout id from another version draw no split, so they count as having none. */
function hasSplit(layoutId: string): boolean {
  return layoutById(layoutId)?.columnRows.some((rows) => rows > 1) ?? false;
}

function trimTrailingHoles(slots: (string | null)[]): (string | null)[] {
  const next = [...slots];
  while (next.length > 0 && next[next.length - 1] === null) next.pop();
  return next;
}

/** A hole is an empty slot in a fixed layout, and meaningless in 자동. */
function tidySlots(layoutId: string, slots: (string | null)[]): (string | null)[] {
  if (isAutoLayout(layoutId)) return slots.filter((id): id is string => id !== null);
  return trimTrailingHoles(slots);
}

function firstHole(slots: readonly (string | null)[], except: number): number {
  return slots.findIndex((slot, index) => slot === null && index !== except);
}

/** A pane leaving the slot: see the rule at the top of this file. */
function vacate(view: SlotViewState, index: number): SlotViewState {
  const slots = [...view.slots];
  if (hasSplit(view.layoutId)) slots[index] = null;
  else slots.splice(index, 1);
  return { ...view, slots: tidySlots(view.layoutId, slots) };
}

/**
 * Drops repeats of a session already placed and handles slots whose session is gone the way any
 * other departure is handled, leaving existing holes alone. With `autoAppend`, sessions the view
 * does not list yet take the first open slot, then the end — that is how a folder's grid fills
 * itself. Callers turn it on at the moments a folder view should catch up
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
  const keepGoneSlots = hasSplit(layoutId);
  const placed = new Set<string>();
  const kept: (string | null)[] = [];
  for (const id of view?.slots ?? []) {
    if (id === null) kept.push(null);
    else if (!known.has(id)) {
      if (keepGoneSlots) kept.push(null);
    } else if (!placed.has(id)) {
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
 * Puts a session in a slot, moving only the panes that have to. A pane already in this view trades
 * places with whatever the slot held, an empty slot included, so its old slot goes empty. A pane
 * from outside the view has no slot to trade, so the one it lands on takes the first open slot, or
 * a new one at the end. Nothing leaves the view unasked.
 *
 * Dropping past the last pane pads with holes and lands on the slot the user aimed at.
 */
export function placeInSlot(view: SlotViewState, index: number, sessionId: string): SlotViewState {
  if (index < 0) return view;
  const from = view.slots.indexOf(sessionId);
  if (from === index) return view;
  const slots: (string | null)[] = [...view.slots];
  while (slots.length <= index) slots.push(null);
  const occupant = slots[index];
  slots[index] = sessionId;
  if (from >= 0) {
    slots[from] = occupant;
  } else if (occupant !== null) {
    const hole = firstHole(slots, -1);
    if (hole >= 0) slots[hole] = occupant;
    else slots.push(occupant);
  }
  return { ...view, slots: tidySlots(view.layoutId, slots) };
}

/**
 * Places a pane before or after another pane in the order the sidebar shows.
 *
 * Reordering a pane already in the view changes only the ids in occupied slots. Fixed-layout holes
 * therefore stay at the same indices and page boundaries do not move. A pane arriving from the
 * other shelf needs a new occupied slot, so it is spliced beside the target without flattening any
 * holes already present.
 */
export function placePaneRelative(
  view: SlotViewState,
  paneId: string,
  targetPaneId: string,
  position: DropPosition,
): SlotViewState {
  if (paneId === targetPaneId) return view;
  const targetSlot = view.slots.indexOf(targetPaneId);
  if (targetSlot < 0) return view;

  const occupiedSlots: number[] = [];
  const paneIds: string[] = [];
  view.slots.forEach((id, index) => {
    if (id === null) return;
    occupiedSlots.push(index);
    paneIds.push(id);
  });

  const from = paneIds.indexOf(paneId);
  if (from < 0) {
    const slots = [...view.slots];
    slots.splice(position === "after" ? targetSlot + 1 : targetSlot, 0, paneId);
    return { ...view, slots: tidySlots(view.layoutId, slots) };
  }

  const ordered = [...paneIds];
  ordered.splice(from, 1);
  const target = ordered.indexOf(targetPaneId);
  ordered.splice(position === "after" ? target + 1 : target, 0, paneId);
  if (ordered.every((id, index) => id === paneIds[index])) return view;

  const slots = [...view.slots];
  occupiedSlots.forEach((slot, index) => {
    slots[slot] = ordered[index];
  });
  return { ...view, slots };
}

/** Takes a pane off the grid without touching the session behind it. */
export function clearSlot(view: SlotViewState, index: number): SlotViewState {
  if (index < 0 || index >= view.slots.length) return view;
  return vacate(view, index);
}

/**
 * Adds a session to the first open slot, or to the end — a drop onto the 작업공간 row, and how the
 * workspace picks up a pane the app has just started holding. An empty slot counts as free, so a
 * shelf fills the gaps in front of it before it grows another page.
 */
export function appendSession(view: SlotViewState, sessionId: string): SlotViewState {
  if (view.slots.includes(sessionId)) return view;
  const slots: (string | null)[] = [...view.slots];
  const hole = firstHole(slots, -1);
  if (hole >= 0) slots[hole] = sessionId;
  else slots.push(sessionId);
  return { ...view, slots: tidySlots(view.layoutId, slots) };
}

/** Takes a session out of this view, wherever it stands. */
export function removeSession(view: SlotViewState, sessionId: string): SlotViewState {
  const index = view.slots.indexOf(sessionId);
  return index < 0 ? view : vacate(view, index);
}

/**
 * Swaps one pane id for another in place — a renamed file keeps its slot instead of vanishing and
 * reopening somewhere else. Only documents need this: a file tab's id is derived from its path.
 */
export function renamePaneId(view: SlotViewState, oldId: string, newId: string): SlotViewState {
  if (!view.slots.includes(oldId)) return view;
  return { ...view, slots: view.slots.map((id) => (id === oldId ? newId : id)) };
}

/**
 * Switching to or from 자동 changes what a hole means, so the slots are tidied to the new rule. A
 * layout that ends every split takes the holes those splits left with it; one that keeps a split
 * keeps them, because they are what holds the panes in their columns.
 */
export function setLayout(view: SlotViewState, layoutId: string): SlotViewState {
  const slots = hasSplit(view.layoutId) && !hasSplit(layoutId) ? view.slots.filter((id) => id !== null) : view.slots;
  return { layoutId, slots: tidySlots(layoutId, [...slots]) };
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
 * slot, which keeps them in the columns they were in.
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
 * Ends this slot's split, whichever of the two panes pressed the button, and no pane leaves the view.
 *
 * When both rows hold a pane, the lower one becomes the next column. The slots do not change, only
 * the layout, and the page size stays the same, so nobody crosses a page. With six columns already
 * there is no next column, so the lower pane goes to the end of the view instead. When a row is
 * empty, the empty row is what goes away and the pane left in the column fills it.
 */
export function mergeColumnAt(
  view: SlotViewState,
  layout: GridLayout,
  page: number,
  slotIndex: number,
): SlotViewState {
  const found = columnOfSlot(layout.columnRows, slotIndex);
  if (!found || found.rows <= 1) return view;
  const upperAt = absoluteSlotOf(view, page, found.start);
  const lowerAt = upperAt + 1;
  const upper = view.slots[upperAt] ?? null;
  const lower = view.slots[lowerAt] ?? null;
  const columnRows = [...layout.columnRows];
  const slots = [...view.slots];
  if (upper !== null && lower !== null) {
    if (columnRows.length < MAX_COLUMNS) {
      columnRows.splice(found.column, 1, 1, 1);
    } else {
      columnRows[found.column] = 1;
      slots.splice(lowerAt, 1);
      slots.push(lower);
    }
  } else {
    columnRows[found.column] = 1;
    slots.splice(lower === null ? lowerAt : upperAt, 1);
  }
  const next = buildLayout(columnRows);
  return { layoutId: next.id, slots: tidySlots(next.id, slots) };
}

/**
 * The page to show after a split or merge. Either one changes how many slots a page holds, so the
 * page that was on screen now draws other panes; this is the page holding the column's top pane.
 */
export function pageAfterColumnChange(
  before: SlotViewState,
  after: SlotViewState,
  layout: GridLayout,
  page: number,
  slotIndex: number,
): number {
  const start = columnOfSlot(layout.columnRows, slotIndex)?.start ?? slotIndex;
  return Math.floor(absoluteSlotOf(before, page, start) / Math.max(viewPageSize(after), 1));
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

/** Every page's panes in slot order, holes left out — what the header's page tabs name. */
export function pagePaneIds(slots: readonly (string | null)[], pageSize: number): string[][] {
  return Array.from({ length: pageCount(slots, pageSize) }, (_, page) =>
    visibleSessionsOf(slots, pageSize, page),
  );
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

/**
 * Drops the saved grids of folders and worktrees that no longer exist. Removing a folder never
 * touched its grid, so state.json kept one entry per folder ever opened. Keys that are neither a
 * known folder nor `@worktree:<known id>` go; the tools grid and anything unprefixed-but-known stay.
 */
export function pruneFolderViews(
  views: Readonly<Record<string, SlotViewState>>,
  projectIds: ReadonlySet<string>,
  worktreeIds: ReadonlySet<string>,
  toolsKey: string,
): Record<string, SlotViewState> {
  return Object.fromEntries(
    Object.entries(views).filter(([key]) => {
      if (key === toolsKey) return true;
      if (key.startsWith("@worktree:")) return worktreeIds.has(key.slice("@worktree:".length));
      return projectIds.has(key);
    }),
  );
}
