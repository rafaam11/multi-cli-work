import { afterEach, describe, expect, it, vi } from "vitest";
import type { SurfaceGraphicsAssetKey, SurfaceGraphicsPlacement } from "@shared/herdr-surface-types";
import { GraphicsCache } from "./graphics-cache";
const key: SurfaceGraphicsAssetKey = { source: { Terminal: { target: { Pane: { pane_id: "p" } }, image_id: 1 } }, image_width: 1, image_height: 1, format: "Png", data_len: 24, data_fingerprint: "18446744073709551615" };
const placement: SurfaceGraphicsPlacement = { asset: key, logical_placement_id: 1, x: 0, y: 0, cols: 1, rows: 1, source_x: 0, source_y: 0, source_width: 1, source_height: 1, x_offset: 0, y_offset: 0, z: 0, scrollback_offset: 0 };
const pngHeader = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1];
afterEach(() => vi.unstubAllGlobals());
describe("graphics lifetime", () => {
  it("keeps an image decoding across a newer scene that references it without resending bytes", async () => {
    let finish: (bitmap: ImageBitmap) => void = () => {};
    vi.stubGlobal("createImageBitmap", () => new Promise<ImageBitmap>((resolve) => { finish = resolve; }));
    const close = vi.fn(), cache = new GraphicsCache();
    const first = cache.update({ assets: [{ key, data: pngHeader }], placements: [placement], retained_assets: [] });
    const next = cache.update({ assets: [], placements: [placement], retained_assets: [] });
    finish({ close } as unknown as ImageBitmap);
    await Promise.all([first, next]);
    expect(cache.size).toBe(1);
    expect(close).not.toHaveBeenCalled();
    await cache.update({ assets: [], placements: [], retained_assets: [] });
    expect(cache.size).toBe(0);
    expect(close).toHaveBeenCalledOnce();
  });
  it("closes an image finishing after disconnect and never resurrects a disposed cache", async () => {
    let finish: (bitmap: ImageBitmap) => void = () => {};
    vi.stubGlobal("createImageBitmap", () => new Promise<ImageBitmap>((resolve) => { finish = resolve; }));
    const close = vi.fn(), cache = new GraphicsCache();
    const loading = cache.update({ assets: [{ key, data: pngHeader }], placements: [placement], retained_assets: [] });
    cache.dispose();
    finish({ close } as unknown as ImageBitmap);
    await loading;
    expect(cache.size).toBe(0);
    expect(close).toHaveBeenCalledOnce();
  });
});
