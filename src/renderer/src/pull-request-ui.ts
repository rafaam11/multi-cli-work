import type { CSSProperties } from "react";

export const DIFF_SIDEBAR_STORAGE_KEY = "multi-cli-work.pr-diff-sidebar.v1";

export function clampDiffSidebarWidth(width: number, containerWidth: number): number {
  return Math.max(180, Math.min(width, 360, Math.floor(containerWidth * 0.4)));
}

export function labelStyle(color: string): CSSProperties {
  if (!/^[0-9a-fA-F]{6}$/.test(color)) return {};
  const red = Number.parseInt(color.slice(0, 2), 16);
  const green = Number.parseInt(color.slice(2, 4), 16);
  const blue = Number.parseInt(color.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return { backgroundColor: `#${color}26`, borderColor: `#${color}80`, color: luminance > 0.68 ? "#111827" : "#ffffff" };
}
