import type { SlotViewState } from "@shared/app-state-types";
import type { Dispatch, SetStateAction } from "react";
import type { DropPosition } from "../project-order";
import type { SnapZone } from "../snap-zones";
import { OTHER_SHELF, type ShelfKind, type Shelves } from "../shelves";
import {
  appendSession,
  clearSlot,
  mergeColumnAt,
  pageOfSession,
  placeInSlot,
  placePaneRelative,
  removeSession,
  type ResolvedView,
  setLayout,
  splitColumnAt,
  viewPageSize,
} from "../slot-view";
import { EMPTY_VIEW, type ActiveView } from "./app-model";

export interface GridContext {
  /** 그리드가 보여 주는 선반. 폴더 그리드면 null. */
  shelfKind: ShelfKind | null;
  folderViewKey: string;
  folderViews: Record<string, SlotViewState>;
  shelves: Shelves;
  /** 화면의 배치(선반 또는 폴더 그리드)와, 그것을 지금 페이지로 푼 것. */
  currentView: SlotViewState;
  resolvedView: ResolvedView;
  focusedPaneId: string | null;
  setFolderViews: Dispatch<SetStateAction<Record<string, SlotViewState>>>;
  setShelves: Dispatch<SetStateAction<Shelves>>;
  setShelfKind: Dispatch<SetStateAction<ShelfKind | null>>;
  setPage: Dispatch<SetStateAction<number>>;
  setFocusedPaneId: Dispatch<SetStateAction<string | null>>;
  setActiveView: Dispatch<SetStateAction<ActiveView>>;
  setActionError: Dispatch<SetStateAction<string | null>>;
  updateFolderView(key: string, mutate: (view: SlotViewState) => SlotViewState): void;
  focusPane(paneId: string): void;
}

/**
 * 그리드 배치를 바꾸는 동작들: 패인을 열고 닫고, 슬롯에 놓고, 열을 나누고, 두 선반(작업공간·숨김)
 * 사이로 옮긴다. App이 매 렌더 부르며, 동작은 그 렌더의 배치를 본다 — App 안에 두었을 때와 같다.
 */
export function createGridActions(context: GridContext) {
  const {
    shelfKind,
    folderViewKey,
    folderViews,
    shelves,
    currentView,
    resolvedView,
    focusedPaneId,
    setFolderViews,
    setShelves,
    setShelfKind,
    setPage,
    setFocusedPaneId,
    setActiveView,
    setActionError,
    updateFolderView,
    focusPane,
  } = context;

  const updateCurrentView = (mutate: (view: SlotViewState) => SlotViewState) => {
    if (shelfKind !== null) {
      const kind = shelfKind;
      setShelves((current) => ({ ...current, [kind]: mutate(current[kind]) }));
      return;
    }
    updateFolderView(folderViewKey, mutate);
  };

  /**
   * Puts a pane on one shelf and takes it off the other in a single update, because the rule the two
   * writes keep is "exactly one shelf holds this pane" — split apart, there would be a paint in
   * between where both do, and the sidebar would draw the pane twice.
   */
  const placePaneOnShelf = (
    kind: ShelfKind,
    paneId: string,
    place: (view: SlotViewState) => SlotViewState,
  ) => {
    setShelves((current) => {
      const other = OTHER_SHELF[kind];
      const next: Shelves = { ...current };
      next[kind] = place(current[kind]);
      next[other] = removeSession(current[other], paneId);
      return next[kind] === current[kind] && next[other] === current[other] ? current : next;
    });
  };

  /**
   * A drop that puts a pane on the grid in front of the user. On a shelf it is also a move between
   * the two: whatever the drop does to this shelf, the pane leaves the other one.
   */
  const placePaneOnCurrentView = (paneId: string, place: (view: SlotViewState) => SlotViewState) => {
    if (shelfKind === null) {
      updateFolderView(folderViewKey, place);
      return;
    }
    placePaneOnShelf(shelfKind, paneId, place);
  };

  /**
   * Puts a pane on one named surface — a shelf, or the selected folder — taking the first free slot
   * or a new one at the end, and goes to it. A document opened from the right sidebar lands here
   * exactly as a session does, which is what makes the two interchangeable in a slot.
   */
  const openPaneOn = (target: ShelfKind | null, paneId: string) => {
    const view = target === null ? (folderViews[folderViewKey] ?? EMPTY_VIEW) : shelves[target];
    const next = appendSession(view, paneId);
    if (target === null) updateFolderView(folderViewKey, () => next);
    else placePaneOnShelf(target, paneId, () => next);
    setShelfKind(target);
    setPage(pageOfSession(next.slots, viewPageSize(next), paneId) ?? 0);
    setFocusedPaneId(paneId);
    setActiveView("terminal");
  };

  /**
   * Opening something onto 숨김 would be a contradiction — a pane the user just asked for is not one
   * they are putting away — so that one case steps across to 작업공간 and opens there.
   */
  const openPane = (paneId: string) => openPaneOn(shelfKind === "hidden" ? "active" : shelfKind, paneId);

  /** A closed document leaves every arrangement — unlike a session, it has no life off the grid. */
  const dropPaneEverywhere = (paneId: string) => {
    setFolderViews((current) =>
      Object.fromEntries(Object.entries(current).map(([key, view]) => [key, removeSession(view, paneId)])),
    );
    setShelves((current) => ({
      active: removeSession(current.active, paneId),
      hidden: removeSession(current.hidden, paneId),
    }));
    setFocusedPaneId((current) => (current === paneId ? null : current));
  };

  /** Page-relative slots are what the grid draws; the arrangement is addressed absolutely. */
  const absoluteSlot = (index: number) => resolvedView.page * viewPageSize(currentView) + index;

  /**
   * The ✕ on a pane. On a folder's grid it empties the slot — the session keeps running, the file
   * stays open, and the panes behind it move forward so the grid is never left with a gap.
   *
   * On a shelf it moves the pane to the other one instead. Emptying a slot of 작업공간 would say
   * nothing, since that shelf collects everything the app holds and would take the pane back on the
   * next pass; 숨김 is where "not on 작업공간" is recorded, so that is where the pane goes.
   */
  const clearSlotAt = (index: number) => {
    const paneId = resolvedView.slots[index] ?? null;
    if (shelfKind !== null) {
      if (paneId !== null) movePaneToOtherShelf(shelfKind, paneId);
      return;
    }
    updateCurrentView((view) => clearSlot(view, absoluteSlot(index)));
    if (paneId !== null && paneId === focusedPaneId) setFocusedPaneId(null);
  };

  /**
   * Splitting is the one arrangement move made from the pane rather than the header, because it is
   * the one that concerns a single column. Both handlers hand over the layout the grid is drawing —
   * on 자동 that is a shape nothing has stored yet — so the slot index means the same thing on both
   * sides. A split pins a 자동 view to that shape; 자동 has no room for a stacked pair.
   */
  const splitColumn = (index: number) => {
    updateCurrentView((view) => splitColumnAt(view, resolvedView.layout, resolvedView.page, index));
  };

  const mergeColumn = (index: number) => {
    updateCurrentView((view) => mergeColumnAt(view, resolvedView.layout, resolvedView.page, index));
  };

  /**
   * A pane dragged to an edge or a corner. The zone names the arrangement that draws that region,
   * so the snap is one move: switch the view onto that preset — off 자동 if it was on it, which is
   * the point of asking for a shape by hand — and put the pane in the slot covering the region.
   * Whatever no longer fits paginates, exactly as picking the preset from the header would do.
   */
  const snapPaneToZone = (zone: SnapZone, paneId: string) => {
    // The zone's slot index is absolute, so the drop lands where the preview drew it.
    setPage(0);
    placePaneOnCurrentView(paneId, (view) =>
      placeInSlot(setLayout(view, zone.layoutId), zone.slotIndex, paneId),
    );
    focusPane(paneId);
  };

  /** Dropping onto a slot inserts the pane there; whoever held it slides back one place. */
  const dropPaneOnSlot = (index: number, paneId: string) => {
    placePaneOnCurrentView(paneId, (view) => placeInSlot(view, absoluteSlot(index), paneId));
    focusPane(paneId);
  };

  /**
   * Picking an arrangement is also picking how many panes fit, so a narrower layout pushes the rest
   * onto later pages rather than dropping them. Going back to the first page keeps the pane the user
   * was looking at in view — it is the one that stays put in every layout.
   */
  const chooseLayout = (layoutId: string) => {
    updateCurrentView((view) => setLayout(view, layoutId));
    setPage(0);
  };

  const selectShelf = (kind: ShelfKind) => {
    const view = shelves[kind];
    setShelfKind(kind);
    setPage(0);
    setFocusedPaneId(view.slots.find((id): id is string => id !== null) ?? null);
    setActiveView("terminal");
    setActionError(null);
  };

  /**
   * Moves a pane onto a shelf: it takes the first free slot there, or a new one at the end, and
   * leaves the other shelf. This is the one road between the two, so a drag onto a sidebar row, the
   * 세션 menu and the ✕ on a pane all end up here and all mean the same thing.
   */
  const movePaneToShelf = (kind: ShelfKind, paneId: string) => {
    placePaneOnShelf(kind, paneId, (view) => appendSession(view, paneId));
    // The pane has just left the grid on screen, so the focus cannot stay on it.
    if (shelfKind !== null && shelfKind !== kind) {
      setFocusedPaneId((current) => (current === paneId ? null : current));
    }
  };

  /**
   * A sidebar pane row is an insertion target rather than an append target. Moving between shelves
   * and placing beside the named row happen in the same state update, preserving the one-shelf rule.
   */
  const placePaneOnShelfRow = (
    kind: ShelfKind,
    paneId: string,
    targetPaneId: string,
    position: DropPosition,
  ) => {
    setShelves((current) => {
      if (!current[kind].slots.includes(targetPaneId)) return current;
      const other = OTHER_SHELF[kind];
      const placed = placePaneRelative(current[kind], paneId, targetPaneId, position);
      const removed = removeSession(current[other], paneId);
      if (placed === current[kind] && removed === current[other]) return current;
      return { ...current, [kind]: placed, [other]: removed };
    });
    if (shelfKind !== null && shelfKind !== kind) {
      setFocusedPaneId((current) => (current === paneId ? null : current));
    }
  };

  /** One press of ✕: 작업공간 → 숨김, 숨김 → 작업공간. The session keeps running either way. */
  const movePaneToOtherShelf = (from: ShelfKind, paneId: string) =>
    movePaneToShelf(OTHER_SHELF[from], paneId);

  /**
   * A pane picked from an expanded shelf row. Unlike `selectShelf` it knows which pane was meant, so
   * it turns to the page holding it — that is how a pane on the shelf's second page gets on screen
   * now that there is no tab bar to click.
   */
  const revealShelfPane = (kind: ShelfKind, paneId: string) => {
    const view = shelves[kind];
    setShelfKind(kind);
    setPage(pageOfSession(view.slots, viewPageSize(view), paneId) ?? 0);
    setFocusedPaneId(paneId);
    setActiveView("terminal");
    setActionError(null);
  };

  return {
    updateCurrentView,
    placePaneOnShelf,
    placePaneOnCurrentView,
    absoluteSlot,
    clearSlotAt,
    splitColumn,
    mergeColumn,
    snapPaneToZone,
    dropPaneOnSlot,
    chooseLayout,
    selectShelf,
    movePaneToShelf,
    placePaneOnShelfRow,
    movePaneToOtherShelf,
    revealShelfPane,
    openPaneOn,
    openPane,
    dropPaneEverywhere,
  };
}
