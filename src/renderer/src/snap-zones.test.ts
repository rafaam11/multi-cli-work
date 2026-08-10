import { describe, expect, it } from "vitest";
import { layoutById } from "./grid-layouts";
import { resolveSnapZone, type SnapRect } from "./snap-zones";

/** 1000×600 makes the bands 96px wide (capped) and 72px tall (12% of 600). */
const grid: SnapRect = { left: 100, top: 50, width: 1000, height: 600 };

const zoneAt = (x: number, y: number) => resolveSnapZone(grid, grid.left + x, grid.top + y);

describe("resolveSnapZone", () => {
  it("reads the edges the way a window manager does", () => {
    expect(zoneAt(500, 4)?.id).toBe("top");
    expect(zoneAt(4, 300)?.id).toBe("left");
    expect(zoneAt(996, 300)?.id).toBe("right");
  });

  it("gives a corner to the corner, not to whichever edge was tested first", () => {
    expect(zoneAt(4, 4)?.id).toBe("top-left");
    expect(zoneAt(996, 4)?.id).toBe("top-right");
    expect(zoneAt(4, 596)?.id).toBe("bottom-left");
    expect(zoneAt(996, 596)?.id).toBe("bottom-right");
  });

  it("leaves the middle and the bottom edge to the ordinary slot-for-slot drop", () => {
    expect(zoneAt(500, 300)).toBeNull();
    expect(zoneAt(500, 596)).toBeNull();
  });

  /** A snap has to land somewhere the picker could also have gone, or the view is left off-catalog. */
  it("names a real preset and a slot that preset actually draws", () => {
    for (const [x, y] of [[500, 4], [4, 300], [996, 300], [4, 4], [996, 4], [4, 596], [996, 596]]) {
      const zone = resolveSnapZone(grid, grid.left + x, grid.top + y)!;
      const layout = layoutById(zone.layoutId);
      expect({ zone: zone.id, layout: layout?.id }).toEqual({ zone: zone.id, layout: zone.layoutId });
      expect(zone.slotIndex).toBeLessThan(layout!.slots);
      expect(zone.slotIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("draws the preview over the region the drop will fill", () => {
    expect(zoneAt(500, 4)?.rect).toEqual({ left: 0, top: 0, width: 1, height: 1 });
    expect(zoneAt(996, 300)?.rect).toEqual({ left: 0.5, top: 0, width: 0.5, height: 1 });
    expect(zoneAt(996, 596)?.rect).toEqual({ left: 0.5, top: 0.5, width: 0.5, height: 0.5 });
  });

  it("keeps the band reachable on a small grid and bounded on a huge one", () => {
    const tiny: SnapRect = { left: 0, top: 0, width: 120, height: 90 };
    // 12% of 120 is 14px, so the floor is what makes the edge hittable at all.
    expect(resolveSnapZone(tiny, 20, 45)?.id).toBe("left");
    expect(resolveSnapZone(tiny, 60, 45)).toBeNull();

    const huge: SnapRect = { left: 0, top: 0, width: 4000, height: 2000 };
    // 12% of 4000 would be 480px of edge; the cap keeps the middle the middle.
    expect(resolveSnapZone(huge, 90, 1000)?.id).toBe("left");
    expect(resolveSnapZone(huge, 200, 1000)).toBeNull();
  });

  it("answers nothing for a cursor outside the grid or a grid with no size yet", () => {
    expect(resolveSnapZone(grid, grid.left - 5, grid.top + 300)).toBeNull();
    expect(resolveSnapZone(grid, grid.left + 500, grid.top + 700)).toBeNull();
    expect(resolveSnapZone({ left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBeNull();
  });
});
