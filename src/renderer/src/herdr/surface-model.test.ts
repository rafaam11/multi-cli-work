import { describe, expect, it } from "vitest";
import type { CellData, PaneSurfaceFrame, PaneSurfacePatch } from "@shared/herdr-surface-types";
import { applySurfaceEvent, decodeColor, selectionText } from "./surface-model";

const cell = (symbol: string): CellData => ({ symbol, fg: 0, bg: 0, modifier: 0, skip: false, hyperlink: null });
export function fixture(): PaneSurfaceFrame {
  return { boot_id: "boot", projection_revision: 1, surface_revision: 1,
    frame: { width: 4, height: 2, cells: [cell("한"), { ...cell(""), skip: true }, cell("a"), cell(" "), cell("é"), cell("🙂"), { ...cell(""), skip: true }, cell("b")], cursor: null, hyperlinks: [], graphics: [] },
    panes: [], splits: [], popup: null, graphics: { assets: [], placements: [], retained_assets: [] } };
}
const patch = (base = 1): PaneSurfacePatch => ({ boot_id: "boot", projection_revision: 1, base_surface_revision: base, surface_revision: base + 1, rows: [{ x: 2, y: 0, cells: [cell("z")] }], panes: [], cursor: null });

describe("Herdr surface state", () => {
  it("applies contiguous patches without mutating the committed full frame", () => {
    const full = fixture();
    const next = applySurfaceEvent(full, { type: "patch", patch: patch() });
    expect(next.status).toBe("applied");
    expect(next.surface?.frame.cells[2].symbol).toBe("z");
    expect(full.frame.cells[2].symbol).toBe("a");
  });
  it("requests resync for a missing base, new boot, or projection mismatch", () => {
    for (const p of [patch(4), { ...patch(), boot_id: "new" }, { ...patch(), projection_revision: 2 }]) {
      expect(applySurfaceEvent(fixture(), { type: "patch", patch: p }).status).toBe("resync");
    }
    expect(applySurfaceEvent(null, { type: "patch", patch: patch() }).status).toBe("resync");
  });
  it("ignores duplicate/out of order revisions and accepts a full snapshot after restart", () => {
    expect(applySurfaceEvent(fixture(), { type: "frame", surface: fixture() }).status).toBe("stale");
    const restarted = { ...fixture(), boot_id: "new", surface_revision: 0 };
    expect(applySurfaceEvent(fixture(), { type: "frame", surface: restarted }).surface).toBe(restarted);
  });
  it("rejects out of bounds patches atomically and malformed or oversized grids", () => {
    const full = fixture();
    const bad = { ...patch(), rows: [...patch().rows, { x: 4, y: 0, cells: [cell("x")] }] };
    expect(applySurfaceEvent(full, { type: "patch", patch: bad }).status).toBe("resync");
    expect(full.frame.cells[2].symbol).toBe("a");
    expect(applySurfaceEvent(null, { type: "frame", surface: { ...full, frame: { ...full.frame, width: 10000 } } }).status).toBe("resync");
    expect(applySurfaceEvent(null, { type: "frame", surface: { ...full, graphics: null } as unknown as PaneSurfaceFrame }).status).toBe("resync");
    expect(applySurfaceEvent(full, { type: "patch", patch: { ...patch(), panes: [{ pane_id: "foreign" }] as PaneSurfacePatch["panes"] } }).status).toBe("resync");
  });
  it("copies grapheme clusters once and trims only row padding", () => {
    expect(selectionText(fixture(), { x: 0, y: 0 }, { x: 3, y: 1 })).toBe("한a\né🙂b");
    expect(selectionText(fixture(), { x: 1, y: 0 }, { x: 1, y: 0 })).toBe("한");
    const realSpacer = fixture(); realSpacer.frame.cells[1].skip = false;
    expect(selectionText(realSpacer, { x: 1, y: 0 }, { x: 1, y: 0 })).toBe("한");
  });
  it("decodes Reset, named, indexed and RGB without treating named colors as RGB", () => {
    expect(decodeColor(0, "#fefefe")).toBe("#fefefe");
    expect(decodeColor(1, "#fff")).toBe("#000000");
    expect(decodeColor(16, "#fff")).toBe("#ffffff");
    expect(decodeColor(0x010000e8, "#fff")).toBe("rgb(8, 8, 8)");
    expect(decodeColor(0x02010203, "#fff")).toBe("rgb(1, 2, 3)");
  });
});
