// @vitest-environment node

import { describe, expect, it } from "vitest";
import { quitAndInstallArguments } from "./updater-platform";

describe("updater restart", () => {
  it("uses silent NSIS only on Windows and always relaunches", () => {
    expect(quitAndInstallArguments("win32")).toEqual([true, true]);
    expect(quitAndInstallArguments("linux")).toEqual([false, true]);
  });
});
