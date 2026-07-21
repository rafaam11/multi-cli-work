import type { GitGraphLayout } from "@shared/git-graph-layout";

export const ROW_HEIGHT = 26;
const LANE_WIDTH = 14;
const GUTTER_PADDING = 10;
const NODE_RADIUS = 4;
const HEAD_NODE_RADIUS = 5.5;

/** GitHub Primer hues, cycled per branch. Eight keeps repeats rare on a busy graph. */
const PALETTE = ["#4493f8", "#3fb950", "#d29922", "#a371f7", "#39c5cf", "#f85149", "#db61a2", "#e3956a"];

export const laneColor = (colorIndex: number): string => PALETTE[colorIndex % PALETTE.length];

/** Lanes are never clamped: a deep history widens the gutter and scrolls rather than collapsing. */
export const laneX = (lane: number): number => lane * LANE_WIDTH + LANE_WIDTH / 2;

export const gutterWidth = (laneCount: number): number =>
  Math.max(laneCount, 1) * LANE_WIDTH + GUTTER_PADDING;

/**
 * Routes a commit to one of its parents, keeping the lane change to a single short curve the way
 * VS Code's Git Graph does, rather than one diagonal drawn across the whole row.
 */
export function edgePath(x0: number, y0: number, x1: number, y1: number, isMerge: boolean): string {
  if (x0 === x1) return `M ${x0} ${y0} L ${x1} ${y1}`;
  const corner = Math.min(ROW_HEIGHT * 0.6, Math.abs(y1 - y0));
  if (isMerge) {
    // Diving out of the merge commit: turn immediately below it, then run straight down.
    const turn = y0 + corner;
    return `M ${x0} ${y0} C ${x0} ${y0 + corner / 2} ${x1} ${turn - corner / 2} ${x1} ${turn} L ${x1} ${y1}`;
  }
  // Landing back on the mainline: run straight down, then turn just above the parent.
  const turn = y1 - corner;
  return `M ${x0} ${y0} L ${x0} ${turn} C ${x0} ${turn + corner / 2} ${x1} ${y1 - corner / 2} ${x1} ${y1}`;
}

export interface GitGraphSvgProps {
  layout: GitGraphLayout;
  /** Inclusive window of rows the list is currently rendering. */
  first: number;
  last: number;
  /** Total content height, so the overlay spans the scroller rather than the viewport. */
  height: number;
  /**
   * Y centre of a row. Injected rather than computed, because the rows and this overlay have to
   * agree once an expanded commit pushes everything below it down.
   */
  rowY(row: number): number;
  headHash: string | null;
  /** Y centre of the pending-changes row, or null when the working tree is clean. */
  uncommittedY: number | null;
}

export function GitGraphSvg({ layout, first, last, height, rowY, headHash, uncommittedY }: GitGraphSvgProps) {
  const head = headHash === null ? null : layout.nodes.find((node) => node.hash === headHash) ?? null;
  // A parent that has not been paged in yet stops one row past the last loaded commit. Anchoring to
  // the content — not the viewport — keeps the stub still while scrolling, and it becomes a real
  // edge as soon as infinite scroll brings the parent in.
  const truncatedY = rowY(layout.nodes.length);

  return (
    <svg
      className="graph-svg"
      width={gutterWidth(layout.laneCount)}
      height={height}
      aria-hidden="true"
    >
      {uncommittedY === null ? null : (
        <>
          <path
            className="graph-edge graph-edge-pending"
            d={`M ${laneX(head?.lane ?? 0)} ${uncommittedY} L ${laneX(head?.lane ?? 0)} ${
              head ? rowY(head.row) : uncommittedY + ROW_HEIGHT / 2
            }`}
            stroke={laneColor(head?.colorIndex ?? 0)}
          />
          <circle
            className="graph-node graph-node-pending"
            cx={laneX(head?.lane ?? 0)}
            cy={uncommittedY}
            r={NODE_RADIUS}
            stroke={laneColor(head?.colorIndex ?? 0)}
          />
        </>
      )}
      {layout.edges
        .filter((edge) => (edge.toRow === null || edge.toRow >= first) && edge.fromRow <= last)
        .map((edge) => (
          <path
            key={`${edge.fromRow}:${edge.toLane}:${edge.isMerge ? "m" : "p"}`}
            className={edge.toRow === null ? "graph-edge graph-edge-truncated" : "graph-edge"}
            d={edgePath(
              laneX(edge.fromLane),
              rowY(edge.fromRow),
              laneX(edge.toLane),
              edge.toRow === null ? truncatedY : rowY(edge.toRow),
              edge.isMerge,
            )}
            stroke={laneColor(edge.colorIndex)}
          />
        ))}
      {layout.nodes.slice(first, last + 1).map((node) => (
        <circle
          key={node.hash}
          className={node.hash === headHash ? "graph-node graph-node-head" : "graph-node"}
          cx={laneX(node.lane)}
          cy={rowY(node.row)}
          r={node.hash === headHash ? HEAD_NODE_RADIUS : NODE_RADIUS}
          fill={laneColor(node.colorIndex)}
        />
      ))}
    </svg>
  );
}
