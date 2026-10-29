import type { CellData, FrameData, HerdrSurfaceEvent, PaneSurfaceFrame, PaneSurfacePane, SurfaceGraphicsAssetKey, SurfaceGraphicsScene, SurfaceRect } from "./herdr-surface-types";

export const MAX_SURFACE_CELLS = 250_000;
const integer = (n: number, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const validCell = (c: CellData) => c && typeof c.symbol === "string" && c.symbol.length <= 256 && integer(c.fg, 0xffffffff) && integer(c.bg, 0xffffffff) && integer(c.modifier, 0xffff) && typeof c.skip === "boolean";
function validFrame(frame: FrameData): boolean {
  return !!frame && integer(frame.width, 4096) && integer(frame.height, 4096) && frame.width > 0 && frame.height > 0
    && frame.width * frame.height <= MAX_SURFACE_CELLS && Array.isArray(frame.cells) && frame.cells.length === frame.width * frame.height
    && frame.cells.every(validCell) && Array.isArray(frame.hyperlinks) && frame.hyperlinks.length <= MAX_SURFACE_CELLS
    && frame.hyperlinks.every((url) => typeof url === "string" && url.length <= 8192)
    && (!frame.cursor || integer(frame.cursor.x, frame.width - 1) && integer(frame.cursor.y, frame.height - 1));
}
const validRect = (rect: SurfaceRect, width: number, height: number): boolean => !!rect && integer(rect.x, width) && integer(rect.y, height)
  && integer(rect.width, width - rect.x) && integer(rect.height, height - rect.y);
const validPane = (pane: PaneSurfacePane, width: number, height: number): boolean => !!pane && typeof pane.pane_id === "string" && integer(pane.content_revision)
  && validRect(pane.rect, width, height) && validRect(pane.inner_rect, width, height)
  && (!pane.scrollbar_rect || validRect(pane.scrollbar_rect, width, height))
  && (!pane.scroll || integer(pane.scroll.max_offset_from_bottom) && integer(pane.scroll.offset_from_bottom, pane.scroll.max_offset_from_bottom) && integer(pane.scroll.viewport_rows));
function validGraphicsKey(key: SurfaceGraphicsAssetKey): boolean {
  if (!key || !key.source || !integer(key.image_width, 4096) || !integer(key.image_height, 4096)
    || !["Png", "Rgb", "Rgba"].includes(key.format) || !integer(key.data_len, 16 * 1024 * 1024)) return false;
  return typeof key.data_fingerprint === "string" ? /^\d{1,20}$/.test(key.data_fingerprint) : integer(key.data_fingerprint);
}
function validGraphics(scene: SurfaceGraphicsScene): boolean {
  if (!scene || !Array.isArray(scene.assets) || scene.assets.length > 64 || !Array.isArray(scene.placements) || scene.placements.length > 2048
    || !Array.isArray(scene.retained_assets) || scene.retained_assets.length > 64 || !scene.retained_assets.every(validGraphicsKey)) return false;
  let bytes = 0;
  return scene.assets.every((asset) => !!asset && validGraphicsKey(asset.key) && Array.isArray(asset.data) && asset.data.length === asset.key.data_len && (bytes += asset.data.length) <= 32 * 1024 * 1024)
    && scene.placements.every((p) => !!p && validGraphicsKey(p.asset) && [p.x, p.y, p.cols, p.rows, p.source_x, p.source_y, p.source_width, p.source_height, p.x_offset, p.y_offset, p.scrollback_offset].every((n) => integer(n, 0xffffffff)) && Number.isSafeInteger(p.z));
}
export interface SurfaceResult { status: "applied" | "stale" | "resync"; surface: PaneSurfaceFrame | null }
/** A patch is committed atomically, only against the exact boot, topology and base revision. */
export function applySurfaceEvent(current: PaneSurfaceFrame | null, event: HerdrSurfaceEvent): SurfaceResult {
  const value = event.type === "patch" ? event.patch : event.surface;
  const result = (status: SurfaceResult["status"], surface = current): SurfaceResult => ({ status, surface });
  if (!value || typeof value.boot_id !== "string" || !integer(value.surface_revision) || !integer(value.projection_revision)) return result("resync");
  if (current && current.boot_id === value.boot_id && value.surface_revision <= current.surface_revision) return result("stale");
  if (event.type !== "patch") {
    const full = event.surface;
    if (!validFrame(full.frame) || full.popup && !validFrame(full.popup.frame) || !Array.isArray(full.panes) || full.panes.length > 256
      || !full.panes.every((pane) => validPane(pane, full.frame.width, full.frame.height)) || !validGraphics(full.graphics)
      || !Array.isArray(full.splits) || full.splits.length > 256) return result("resync");
    return result("applied", event.surface);
  }
  const patch = event.patch;
  if (!current || current.boot_id !== patch.boot_id || current.surface_revision !== patch.base_surface_revision
      || current.projection_revision !== patch.projection_revision || patch.surface_revision !== patch.base_surface_revision + 1
      || !Array.isArray(patch.rows) || patch.rows.length > MAX_SURFACE_CELLS || !Array.isArray(patch.panes)
      || patch.panes.some((pane) => !validPane(pane, current.frame.width, current.frame.height) || !current.panes.some((existing) => existing.pane_id === pane.pane_id))) return result("resync");
  const { width, height } = current.frame;
  if (patch.rows.some((r) => !integer(r.x, width - 1) || !integer(r.y, height - 1) || !Array.isArray(r.cells)
    || r.cells.length > width - r.x || !r.cells.every(validCell))
    || patch.cursor && (!integer(patch.cursor.x, width - 1) || !integer(patch.cursor.y, height - 1))) return result("resync");
  const cells = current.frame.cells.slice();
  for (const row of patch.rows) for (let i = 0; i < row.cells.length; i++) cells[row.y * width + row.x + i] = row.cells[i];
  const changed = new Map(patch.panes.map((pane) => [pane.pane_id, pane]));
  return result("applied", { ...current, surface_revision: patch.surface_revision,
    frame: { ...current.frame, cells, cursor: patch.cursor }, panes: current.panes.map((pane) => changed.get(pane.pane_id) ?? pane) });
}

export const ANSI_COLORS = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5", "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff"];
export function decodeColor(color: number, fallback: string): string {
  const index = color & 255;
  switch (color >>> 24) {
    case 0: return index === 0 ? fallback : ANSI_COLORS[index - 1] ?? fallback;
    case 1: {
      if (index < 16) return ANSI_COLORS[index];
      if (index >= 232) { const grey = 8 + (index - 232) * 10; return `rgb(${grey}, ${grey}, ${grey})`; }
      const cube = [0, 95, 135, 175, 215, 255], n = index - 16;
      return `rgb(${cube[Math.floor(n / 36)]}, ${cube[Math.floor(n / 6) % 6]}, ${cube[n % 6]})`;
    }
    case 2: return `rgb(${color >>> 16 & 255}, ${color >>> 8 & 255}, ${index})`;
    default: return fallback;
  }
}
export interface CellPoint { x: number; y: number }
export function selectionText(surface: PaneSurfaceFrame, start: CellPoint, end: CellPoint): string {
  const { width, height, cells } = surface.frame;
  const pos = (p: CellPoint) => Math.max(0, Math.min(width * height - 1, p.y * width + p.x));
  let first = Math.min(pos(start), pos(end)), last = Math.max(pos(start), pos(end));
  while (first % width > 0 && (cells[first].skip || cells[first].symbol === "")) first--;
  const lines: string[] = [];
  for (let y = Math.floor(first / width); y <= Math.floor(last / width); y++) {
    let text = "";
    for (let x = y === Math.floor(first / width) ? first % width : 0; x <= (y === Math.floor(last / width) ? last % width : width - 1); x++) {
      const c = cells[y * width + x];
      if (!c.skip) text += c.symbol;
    }
    lines.push(text.replace(/ +$/u, ""));
  }
  return lines.join("\n");
}
