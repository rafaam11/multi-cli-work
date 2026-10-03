// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { isMainWindowSender, mainWindowState, sendToMainWindow } from "./main-window";

function fakeWindow(state: Partial<{ destroyed: boolean; visible: boolean; focused: boolean }> = {}) {
  const current = { destroyed: false, visible: true, focused: true, ...state };
  return {
    webContents: { send: vi.fn() },
    isDestroyed: () => current.destroyed,
    isVisible: () => current.visible,
    isFocused: () => current.focused,
  };
}

describe("mainWindowState", () => {
  it("reports the main window only", () => {
    expect(mainWindowState(fakeWindow())).toEqual({ visible: true, focused: true });
    // 원격 창에 포커스가 가 있으면 메인 창은 보이지만 포커스가 없다 — 로컬 알림이 억제되면 안 된다.
    expect(mainWindowState(fakeWindow({ focused: false }))).toEqual({ visible: true, focused: false });
  });

  it("treats a missing, destroyed, or hidden window as unfocused", () => {
    expect(mainWindowState(null)).toEqual({ visible: false, focused: false });
    expect(mainWindowState(fakeWindow({ destroyed: true }))).toEqual({ visible: false, focused: false });
    expect(mainWindowState(fakeWindow({ visible: false }))).toEqual({ visible: false, focused: false });
  });
});

describe("sendToMainWindow", () => {
  it("sends to a live window and does nothing otherwise", () => {
    const window = fakeWindow();
    sendToMainWindow(window, "terminal:event", { type: "data" });
    expect(window.webContents.send).toHaveBeenCalledWith("terminal:event", { type: "data" });

    const gone = fakeWindow({ destroyed: true });
    sendToMainWindow(gone, "terminal:event", {});
    sendToMainWindow(null, "terminal:event", {});
    expect(gone.webContents.send).not.toHaveBeenCalled();
  });
});

describe("isMainWindowSender", () => {
  it("accepts only the main window's own webContents", () => {
    const window = fakeWindow();
    expect(isMainWindowSender(window, { sender: window.webContents })).toBe(true);
    expect(isMainWindowSender(window, { sender: fakeWindow().webContents })).toBe(false);
    expect(isMainWindowSender(window, {})).toBe(false);
    expect(isMainWindowSender(null, { sender: window.webContents })).toBe(false);
    expect(isMainWindowSender(fakeWindow({ destroyed: true }), {})).toBe(false);
  });
});
