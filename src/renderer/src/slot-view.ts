import type { SlotViewState } from "@shared/app-state-types";
import {
  DEFAULT_LAYOUT_ID,
  MAX_LAYOUT_SLOTS,
  autoLayoutFor,
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
 * `floor(n / pageSize)`. Trailing holes are always trimmed — the layout already says how many slots
 * a page draws — but holes with something after them are kept, because those are positions the user
 * deliberately left open as drop targets.
 *
 * A 자동 view is the exception: it holds no holes at all. Its layout follows the session count, so
 * an empty slot would only ever be a slot the layout was about to stop drawing.
 */

function trimTrailingHoles(slots: (string | null)[]): (string | null)[] {
  const next = [...slots];
  while (next.length > 0 && next[next.length - 1] === null) next.pop();
  return next;
}

/** Holes are drop targets in a fixed layout and meaningless in 자동, which closes them up. */
function tidySlots(layoutId: string, slots: (string | null)[]): (string | null)[] {
  if (isAutoLayout(layoutId)) return slots.filter((id): id is string => id !== null);
  return trimTrailingHoles(slots);
}

function firstHole(slots: readonly (string | null)[], except: number): number {
  return slots.findIndex((slot, index) => slot === null && index !== except);
}

/**
 * Drops slots whose session is gone and repeats of a session already placed. With `autoAppend`,
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
  const slots: (string | null)[] = tidySlots(
    layoutId,
    (view?.slots ?? []).map((id) => {
      if (id === null || !known.has(id) || placed.has(id)) return null;
      placed.add(id);
      return id;
    }),
  );
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
 * Moves a session into a slot. If it already sat elsewhere in this view the two trade places,
 * which is what dragging one pane onto another means. If it did not, whoever held the slot is
 * pushed to the nearest open slot rather than dropped, so nothing leaves the view unasked.
 */
export function placeInSlot(view: SlotViewState, index: number, sessionId: string): SlotViewState {
  if (index < 0) return view;
  const slots: (string | null)[] = [...view.slots];
  while (slots.length <= index) slots.push(null);
  const from = slots.indexOf(sessionId);
  if (from === index) return view;
  const displaced = slots[index];
  slots[index] = sessionId;
  if (from >= 0) {
    slots[from] = displaced;
  } else if (displaced !== null) {
    const hole = firstHole(slots, index);
    if (hole >= 0) slots[hole] = displaced;
    else slots.push(displaced);
  }
  return { ...view, slots: tidySlots(view.layoutId, slots) };
}

/** Empties a slot without touching the session behind it. */
export function clearSlot(view: SlotViewState, index: number): SlotViewState {
  if (index < 0 || index >= view.slots.length) return view;
  const slots = [...view.slots];
  slots[index] = null;
  return { ...view, slots: tidySlots(view.layoutId, slots) };
}

/** Adds a session to the first open slot, or to the end — a drop onto a workspace row. */
export function appendSession(view: SlotViewState, sessionId: string): SlotViewState {
  if (view.slots.includes(sessionId)) return view;
  const slots: (string | null)[] = [...view.slots];
  const hole = firstHole(slots, -1);
  if (hole >= 0) slots[hole] = sessionId;
  else slots.push(sessionId);
  return { ...view, slots: tidySlots(view.layoutId, slots) };
}

/** Leaves a hole where the session was: every other pane keeps the slot the user gave it. */
export function removeSession(view: SlotViewState, sessionId: string): SlotViewState {
  if (!view.slots.includes(sessionId)) return view;
  return {
    ...view,
    slots: tidySlots(
      view.layoutId,
      view.slots.map((id) => (id === sessionId ? null : id)),
    ),
  };
}

/** Switching to or from 자동 changes what a hole means, so the slots are tidied to the new rule. */
export function setLayout(view: SlotViewState, layoutId: string): SlotViewState {
  return { layoutId, slots: tidySlots(layoutId, [...view.slots]) };
}

/**
 * How many slots one page holds. A preset says so itself; 자동 has no fixed answer, so it takes the
 * ceiling and lets the page's own session count choose the arrangement.
 */
export function viewPageSize(view: SlotViewState): number {
  if (isAutoLayout(view.layoutId)) return MAX_LAYOUT_SLOTS;
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

/**
 * Where a pane the app shelves by itself should land. The workspaces read as one shelf: page 1 of
 * 작업공간1 fills before page 1 of 작업공간2, and only once every workspace's first page is full does
 * 작업공간1 open a second page. A hole left behind by a pane that went away counts as free, so the
 * shelf closes up instead of only ever growing.
 *
 * A page holds as many panes as that workspace's own layout draws — six on 자동, which is the default
 * and the ceiling for every preset.
 */
export function nextWorkspaceSlot(
  views: readonly SlotViewState[],
): { index: number; slot: number } | null {
  if (views.length === 0) return null;
  const sizes = views.map(viewPageSize);
  const pages = Math.max(...views.map((view, index) => pageCount(view.slots, sizes[index])));
  // One page past the fullest workspace is empty by definition, so the scan always finds a slot.
  for (let page = 0; page <= pages; page += 1) {
    for (let index = 0; index < views.length; index += 1) {
      const start = page * sizes[index];
      for (let slot = start; slot < start + sizes[index]; slot += 1) {
        if ((views[index].slots[slot] ?? null) === null) return { index, slot };
      }
    }
  }
  return null;
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
