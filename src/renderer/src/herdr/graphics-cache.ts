import type { SurfaceGraphicsAssetKey, SurfaceGraphicsScene, SurfaceGraphicsPlacement } from "@shared/herdr-surface-types";

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_ASSETS = 64;
const MAX_PIXELS = 4 * 1024 * 1024;
export const graphicsKey = (key: SurfaceGraphicsAssetKey): string => JSON.stringify([key.source, key.image_width, key.image_height, key.format, key.data_len, String(key.data_fingerprint)]);
interface CachedImage { image: CanvasImageSource; bytes: number; close(): void }
/** Connection-local cache. Only complete inline image bytes are accepted; no external URLs. */
export class GraphicsCache {
  private images = new Map<string, CachedImage>();
  private generation = 0;
  private live = new Set<string>();
  private loading = new Map<string, number>();
  private loadingBytes = 0;
  private loadingCount = 0;
  get size(): number { return this.images.size; }
  get byteLength(): number { let n = 0; for (const entry of this.images.values()) n += entry.bytes; return n; }
  private remove(key: string): void { const entry = this.images.get(key); entry?.close(); this.images.delete(key); }
  async update(scene: SurfaceGraphicsScene): Promise<void> {
    const generation = this.generation;
    const live = new Set([...scene.placements.map((p) => p.asset), ...scene.retained_assets].map(graphicsKey));
    this.live = live;
    for (const key of this.images.keys()) if (!live.has(key)) this.remove(key);
    // Sequential decoding bounds peak memory while frames/patches continue to arrive.
    for (const asset of scene.assets.slice(0, MAX_ASSETS)) {
      const key = asset.key, id = graphicsKey(key), pixels = key.image_width * key.image_height;
      if (!this.live.has(id) || this.images.has(id) || this.loading.get(id) === generation || !Number.isSafeInteger(pixels) || pixels <= 0 || pixels > MAX_PIXELS
        || key.image_width > 4096 || key.image_height > 4096 || !Number.isSafeInteger(key.data_len)
        || key.data_len !== asset.data.length || key.data_len > 16 * 1024 * 1024
        || !asset.data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) continue;
      const bytes = pixels * 4;
      if (bytes > MAX_BYTES || this.images.size + this.loadingCount >= MAX_ASSETS || this.byteLength + this.loadingBytes + bytes > MAX_BYTES) continue;
      this.loading.set(id, generation); this.loadingBytes += bytes; this.loadingCount++;
      try {
        let image: CachedImage;
        if (key.format === "Png") {
          if (asset.data.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => asset.data[i] === v)) continue;
          const raw = Uint8Array.from(asset.data), view = new DataView(raw.buffer);
          if (view.getUint32(16) !== key.image_width || view.getUint32(20) !== key.image_height) continue;
          const blob = new Blob([raw], { type: "image/png" });
          if (typeof createImageBitmap === "function") {
            const bitmap = await createImageBitmap(blob);
            image = { image: bitmap, bytes, close: () => bitmap.close() };
          } else {
            const url = URL.createObjectURL(blob), element = new Image();
            try {
              await new Promise<void>((resolve, reject) => { element.onload = () => resolve(); element.onerror = reject; element.src = url; });
              image = { image: element, bytes, close: () => { element.src = ""; } };
            } finally { URL.revokeObjectURL(url); }
          }
        } else if (key.format === "Rgb" || key.format === "Rgba") {
          const channels = key.format === "Rgb" ? 3 : 4;
          if (asset.data.length !== pixels * channels) continue;
          const canvas = document.createElement("canvas");
          canvas.width = key.image_width; canvas.height = key.image_height;
          const context = canvas.getContext("2d");
          if (!context) continue;
          const rgba = new Uint8ClampedArray(pixels * 4);
          for (let i = 0; i < pixels; i++) {
            rgba[i * 4] = asset.data[i * channels]; rgba[i * 4 + 1] = asset.data[i * channels + 1];
            rgba[i * 4 + 2] = asset.data[i * channels + 2]; rgba[i * 4 + 3] = channels === 4 ? asset.data[i * channels + 3] : 255;
          }
          context.putImageData(new ImageData(rgba, key.image_width, key.image_height), 0, 0);
          image = { image: canvas, bytes, close: () => { canvas.width = canvas.height = 0; } };
        } else continue;
        if (generation !== this.generation) { image.close(); return; }
        if (!this.live.has(id)) { image.close(); continue; }
        this.images.set(id, image);
      } catch { /* A bad graphics asset must never interrupt text rendering. */ }
      finally { if (this.loading.get(id) === generation) this.loading.delete(id); this.loadingBytes -= bytes; this.loadingCount--; }
    }
  }
  draw(context: CanvasRenderingContext2D, placements: SurfaceGraphicsPlacement[], cellWidth: number, cellHeight: number, foreground: boolean, popupId?: string): void {
    for (const p of placements.slice(0, 2048).sort((a, b) => a.z - b.z)) {
      if ((p.z >= 0) !== foreground) continue;
      const source = p.asset.source;
      const popup = "Terminal" in source && "Popup" in source.Terminal.target ? source.Terminal.target.Popup.terminal_id : undefined;
      if (popup !== popupId) continue;
      const image = this.images.get(graphicsKey(p.asset));
      if (!image || p.source_width <= 0 || p.source_height <= 0 || p.cols <= 0 || p.rows <= 0) continue;
      context.drawImage(image.image, p.source_x, p.source_y, p.source_width, p.source_height,
        p.x * cellWidth + p.x_offset, p.y * cellHeight + p.y_offset, Math.max(1, p.cols * cellWidth - p.x_offset), Math.max(1, p.rows * cellHeight - p.y_offset));
    }
  }
  dispose(): void { this.generation++; this.live.clear(); for (const key of this.images.keys()) this.remove(key); }
}
