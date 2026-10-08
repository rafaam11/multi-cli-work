// @vitest-environment node

import { describe, expect, it } from "vitest";
import { desktopPresence } from "./desktop-presence";

describe("desktopPresence", () => {
  it("is focused only while the main window has focus and the user is at the PC", () => {
    expect(desktopPresence({ visible: true, focused: true }, "active")).toBe("focused");
  });

  it("is active when the user is at the PC but in another window", () => {
    expect(desktopPresence({ visible: true, focused: false }, "active")).toBe("active");
    expect(desktopPresence({ visible: false, focused: false }, "active")).toBe("active");
  });

  it("is away once the PC is idle or locked, even with the window focused", () => {
    // 창을 켜 둔 채 자리를 비우면 폰이 대신 알려야 한다.
    expect(desktopPresence({ visible: true, focused: true }, "idle")).toBe("away");
    expect(desktopPresence({ visible: true, focused: true }, "locked")).toBe("away");
    expect(desktopPresence({ visible: true, focused: true }, "unknown")).toBe("away");
  });
});
