import { app, BrowserWindow, shell } from "electron";
import electronUpdater, { type ProgressInfo, type UpdateInfo } from "electron-updater";
import type { UpdaterStatus } from "../shared/api-types";

// electron-updater ships CommonJS; a named import is undefined once the main process is bundled.
const { autoUpdater } = electronUpdater;

const RELEASES_URL = "https://github.com/rafaam11/multi-cli-work/releases/latest";

let currentStatus: UpdaterStatus = { state: "idle" };

function publish(status: UpdaterStatus): void {
  currentStatus = status;
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send("updater:event", status);
}

/** The renderer mounts after the first check starts, so it reads the current state instead of waiting for an event. */
export function updaterStatus(): UpdaterStatus {
  return currentStatus;
}

/**
 * Wires autoUpdater and starts one silent check.
 * Development builds have no update feed, so every entry point is a no-op that reports "idle".
 */
export function initUpdater(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => publish({ state: "checking" }));
  autoUpdater.on("update-available", (info: UpdateInfo) => publish({ state: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => publish({ state: "idle" }));
  autoUpdater.on("download-progress", (progress: ProgressInfo) =>
    publish({ state: "downloading", percent: Math.round(progress.percent) }),
  );
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => publish({ state: "downloaded", version: info.version }));
  autoUpdater.on("error", (error: Error) => publish({ state: "error", message: String(error?.message ?? error) }));
  void autoUpdater.checkForUpdatesAndNotify();
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) {
    publish({ state: "idle" });
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    publish({ state: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

export function quitAndInstall(): void {
  if (!app.isPackaged) return;
  // isSilent=true runs the NSIS installer with /S. It also makes quitAndInstall read isForceRunAfter
  // instead of autoRunAppAfterInstall, so both flags must be true for the app to come back up.
  autoUpdater.quitAndInstall(true, true);
}

export function openReleasesPage(): void {
  void shell.openExternal(RELEASES_URL);
}
