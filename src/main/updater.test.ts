// @vitest-environment node

import { describe, expect, it } from "vitest";
import { configureAutoUpdater, quitAndInstallArguments } from "./updater-platform";

describe("updater restart", () => {
  it("uses silent NSIS only on Windows and always relaunches", () => {
    expect(quitAndInstallArguments("win32")).toEqual([true, true]);
    expect(quitAndInstallArguments("linux")).toEqual([false, true]);
  });
});

describe("updater configuration", () => {
  it("downloads and installs on quit, and says it never uses a web installer", () => {
    const updater = { autoDownload: false, autoInstallOnAppQuit: false, disableWebInstaller: false };
    configureAutoUpdater(updater);
    expect(updater).toEqual({ autoDownload: true, autoInstallOnAppQuit: true, disableWebInstaller: true });
  });
});
