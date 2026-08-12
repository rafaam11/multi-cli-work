import type { SlotViewState } from "@shared/app-state-types";

/**
 * The two grids the sidebar offers above the folder tree.
 *
 * 작업공간 shows everything the app is holding — every session, every open document — and fills
 * itself, so nothing has to be dragged into it. 숨김 is the exception list that makes such a grid
 * usable: panes still running or still open, but taken off 작업공간 for now. It is a grid of its own,
 * so looking at what was put away is a click rather than an undo.
 *
 * A pane sits in exactly one of the two. That is why the ✕ on a pane moves it to the other shelf
 * instead of emptying its slot: on a shelf that collects by itself, an emptied slot would only be
 * refilled on the next pass.
 */
export type ShelfKind = "active" | "hidden";

/** Sidebar order, and the order anything that walks both shelves should use. */
export const SHELF_KINDS = ["active", "hidden"] as const;

export interface Shelves {
  active: SlotViewState;
  hidden: SlotViewState;
}

/** Where a pane goes when it leaves this shelf — there is only ever one other place. */
export const OTHER_SHELF: Record<ShelfKind, ShelfKind> = { active: "hidden", hidden: "active" };

/**
 * Every word the shelves are named with, in one place, so the sidebar row, the grid header, the
 * pane's ✕ and the 세션 menu never drift into calling the same move two different things.
 *
 * `move` is what leaving this shelf does, which is why 작업공간's reads as "숨기기" and 숨김's as
 * "다시 표시". `subtitle` is the header's line for an empty shelf and `empty`/`emptyHint` the grid's,
 * kept apart so the two do not read as the same sentence printed twice.
 */
export const SHELF_TEXT: Record<
  ShelfKind,
  { name: string; subtitle: string; empty: string; emptyHint: string; move: string; moveTitle: string }
> = {
  active: {
    name: "작업공간",
    subtitle: "실행 중인 세션이나 열린 문서가 없습니다",
    empty: "작업공간이 비어 있습니다",
    emptyHint: "세션을 시작하거나 문서를 열면 여기에 모입니다.",
    move: "작업공간에서 숨기기",
    moveTitle: "작업공간에서 숨기기 (세션은 계속 실행됩니다)",
  },
  hidden: {
    name: "숨김",
    subtitle: "숨긴 세션이나 문서가 없습니다",
    empty: "숨긴 세션이나 문서가 없습니다",
    emptyHint: "작업공간에서 ✕를 누르면 여기로 옮겨집니다.",
    move: "작업공간에 다시 표시",
    moveTitle: "작업공간에 다시 표시",
  },
};
