import { afterEach, expect, it, vi } from "vitest";
import script from "../../../../android/app/src/main/assets/legacy-viewing.js?raw";

const target = window as unknown as { McwShell?: unknown; __mcwSessionViewingV2?: boolean; __mcwLegacyViewingStop?: () => void };
afterEach(() => {
  target.__mcwLegacyViewingStop?.();
  delete target.__mcwSessionViewingV2;
  delete target.McwShell;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("observes an actual old frontend shape without requiring new JS callbacks, and clears on background/list navigation", async () => {
  vi.useFakeTimers();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 0, left: 0, right: 390, bottom: 600, width: 390, height: 600, x: 0, y: 0, toJSON() {} });
  let foreground = true;
  const viewed = vi.fn();
  target.McwShell = { isForeground: () => foreground, legacyViewingSession: viewed };
  window.history.replaceState(null, "", "#session=old-session");
  // Markup served by the pre-v2 host; no viewingSession calls or new capability marker.
  document.body.innerHTML = '<main class="m-session-screen"><header class="m-bar"><span class="m-status m-status-awaiting-input">입력 대기</span></header><div class="m-terminal"><div class="xterm-rows">Old host answer</div></div></main>';
  new Function(script)();
  await vi.runOnlyPendingTimersAsync();
  expect(viewed).toHaveBeenLastCalledWith("old-session", "awaiting-input");
  foreground = false;
  window.dispatchEvent(new Event("mcw-foreground"));
  await vi.runOnlyPendingTimersAsync();
  expect(viewed).toHaveBeenLastCalledWith("", "");
  foreground = true;
  window.dispatchEvent(new Event("mcw-foreground"));
  await vi.runOnlyPendingTimersAsync();
  expect(viewed).toHaveBeenLastCalledWith("old-session", "awaiting-input");
  document.body.innerHTML = '<section class="m-list">Session list</section>';
  await Promise.resolve();
  await vi.runOnlyPendingTimersAsync();
  expect(viewed).toHaveBeenLastCalledWith("", "");
});
it("leaves the new generation-aware frontend in control", () => {
  const viewed = vi.fn();
  target.__mcwSessionViewingV2 = true;
  target.McwShell = { legacyViewingSession: viewed };
  new Function(script)();
  expect(viewed).not.toHaveBeenCalled();
});
