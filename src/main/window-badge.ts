import type { AttentionSnapshot, WindowAttention } from "./attention-policy";

export const APP_TRAY_TOOLTIP = "멀티 터미널 작업기";

/** Sidebar status colours (violet = input, amber = approval), so the taskbar tells the same story. */
const DOT_COLOURS: Record<Exclude<WindowAttention, "none">, readonly [number, number, number]> = {
  input: [0xaa, 0x8c, 0xcc],
  approval: [0xd8, 0xa2, 0x4a],
};

/**
 * Raw premultiplied-BGRA pixels of a filled, anti-aliased dot. nativeImage cannot rasterise SVG
 * and shipping pre-rendered PNGs per colour is not worth it, so the overlay is drawn pixel by
 * pixel — which also keeps this module free of Electron imports and unit-testable.
 */
export function attentionDotBitmap(size: number, [red, green, blue]: readonly [number, number, number]): Buffer {
  const bytes = Buffer.alloc(size * size * 4);
  const centre = (size - 1) / 2;
  const radius = size / 2 - 1;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x - centre, y - centre);
      const alpha = Math.round(255 * Math.min(1, Math.max(0, radius - distance + 0.5)));
      if (alpha === 0) continue;
      const offset = (y * size + x) * 4;
      bytes[offset] = Math.round((blue * alpha) / 255);
      bytes[offset + 1] = Math.round((green * alpha) / 255);
      bytes[offset + 2] = Math.round((red * alpha) / 255);
      bytes[offset + 3] = alpha;
    }
  }
  return bytes;
}

export interface TaskbarBadgeSpec {
  /** Base size in device-independent pixels; `bitmap` is size², `bitmap2x` is (2·size)². */
  size: number;
  bitmap: Buffer;
  bitmap2x: Buffer;
  /** Read by screen readers in place of the dot. */
  description: string;
}

export function taskbarBadgeSpec(snapshot: AttentionSnapshot, size = 16): TaskbarBadgeSpec | null {
  if (snapshot.window === "none") return null;
  const colour = DOT_COLOURS[snapshot.window];
  return {
    size,
    bitmap: attentionDotBitmap(size, colour),
    bitmap2x: attentionDotBitmap(size * 2, colour),
    description: `응답 대기 세션 ${Object.keys(snapshot.unread).length}개`,
  };
}

export function trayTooltip(snapshot: AttentionSnapshot): string {
  const count = Object.keys(snapshot.unread).length;
  return count === 0 ? APP_TRAY_TOOLTIP : `${APP_TRAY_TOOLTIP} — 응답 대기 ${count}개`;
}
