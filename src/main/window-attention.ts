import type { WindowAttention } from "./attention-policy";

export const APP_WINDOW_TITLE = "멀티 터미널 작업기";

export interface AttentionWindow {
  isDestroyed(): boolean;
  setTitle(title: string): void;
  flashFrame(flag: boolean): void;
}

export function applyWindowAttention(window: AttentionWindow, attention: WindowAttention): void {
  if (window.isDestroyed()) return;
  const prefix = attention === "approval" ? "! " : attention === "input" ? "● " : "";
  window.setTitle(`${prefix}${APP_WINDOW_TITLE}`);
  window.flashFrame(attention !== "none");
}
