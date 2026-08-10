/**
 * Where a pane lands when it is dragged to the edge of the grid, in the shape Windows taught
 * everyone: the top maximizes, a side takes half, a corner takes a quarter. The grid has no free
 * geometry to give — a view is a preset plus its slots — so a snap is expressed in the only terms
 * the grid has: pick the preset that draws that region as a slot, and put the pane in it.
 *
 * The pane counts follow from the regions themselves. Half of the screen is 좌우, a quarter is 2×2,
 * and the whole of it is 전체 — every one of them a preset the picker already offers, so a snap
 * never leaves the view somewhere the user could not have chosen by hand.
 */

export type SnapZoneId =
  | "top"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface SnapZone {
  id: SnapZoneId;
  /** The preset this region belongs to. Snapping switches the view onto it, 자동 included. */
  layoutId: string;
  /** Which of that preset's slots covers the region, counted from 0 as `slots` is. */
  slotIndex: number;
  /** Said out loud on the drag preview, so the drop is not a guess. */
  label: string;
  /** The region as fractions of the grid, for the preview drawn over it. */
  rect: { left: number; top: number; width: number; height: number };
}

/**
 * How deep a band has to be to read as "the edge". A share of the grid keeps it proportional on a
 * wide monitor, and the bounds keep it reachable on a small pane without swallowing the middle —
 * where dragging still means what it always did, trading places with the pane already there.
 */
const BAND_SHARE = 0.12;
const MIN_BAND = 28;
const MAX_BAND = 96;

function band(length: number): number {
  return Math.min(Math.max(length * BAND_SHARE, MIN_BAND), MAX_BAND);
}

/** `4-quad` reads `"s1 s2" "s3 s4"`, so its slots are the quarters in this order. */
const CORNERS: Record<string, { id: SnapZoneId; slotIndex: number; label: string }> = {
  "left-top": { id: "top-left", slotIndex: 0, label: "좌상 (4칸)" },
  "right-top": { id: "top-right", slotIndex: 1, label: "우상 (4칸)" },
  "left-bottom": { id: "bottom-left", slotIndex: 2, label: "좌하 (4칸)" },
  "right-bottom": { id: "bottom-right", slotIndex: 3, label: "우하 (4칸)" },
};

export interface SnapRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The zone the cursor is in, or null for the interior. Corners win over edges: a cursor in both
 * bands at once is aiming at the corner, which is the harder target of the two to hit on purpose.
 *
 * The bottom edge has no zone of its own. Every arrangement that would fit there is already one
 * click away in the picker, and leaving it inert keeps the pane most likely to be dragged past —
 * the one on the bottom row — droppable on its neighbour the ordinary way.
 */
export function resolveSnapZone(rect: SnapRect, clientX: number, clientY: number): SnapZone | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;

  const horizontal = band(rect.width);
  const vertical = band(rect.height);
  const side = x <= horizontal ? "left" : x >= rect.width - horizontal ? "right" : null;
  const end = y <= vertical ? "top" : y >= rect.height - vertical ? "bottom" : null;

  if (side && end) {
    const corner = CORNERS[`${side}-${end}`];
    return {
      ...corner,
      layoutId: "4-quad",
      rect: { left: side === "left" ? 0 : 0.5, top: end === "top" ? 0 : 0.5, width: 0.5, height: 0.5 },
    };
  }
  if (end === "top") {
    return { id: "top", layoutId: "solo", slotIndex: 0, label: "전체", rect: { left: 0, top: 0, width: 1, height: 1 } };
  }
  if (side === "left") {
    return { id: "left", layoutId: "2-col", slotIndex: 0, label: "좌측 (2칸)", rect: { left: 0, top: 0, width: 0.5, height: 1 } };
  }
  if (side === "right") {
    return { id: "right", layoutId: "2-col", slotIndex: 1, label: "우측 (2칸)", rect: { left: 0.5, top: 0, width: 0.5, height: 1 } };
  }
  return null;
}
