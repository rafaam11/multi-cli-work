// @vitest-environment node

import { describe, expect, it } from "vitest";
import { windowChromeOptions } from "./window-chrome";

describe("windowChromeOptions", () => {
  it("hides only the caption bar on Windows so the native frame survives", () => {
    expect(windowChromeOptions("win32")).toEqual({ titleBarStyle: "hidden" });
  });

  it("drops the frame everywhere else, because titleBarStyle is a no-op there", () => {
    expect(windowChromeOptions("linux")).toEqual({ frame: false });
    expect(windowChromeOptions("darwin")).toEqual({ frame: false });
  });
});
