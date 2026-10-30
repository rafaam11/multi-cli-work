import { app, shell } from "electron";
import electronUpdater, { type ProgressInfo, type UpdateInfo } from "electron-updater";
import path from "node:path";
import type { UpdaterStatus } from "../shared/api-types";
import { sendToMainWindow, type MainWindowLike } from "./main-window";
import { recordInstallAttempt, takeInstallAttempt } from "./update-attempt";
import { createUpdaterLogger, type UpdaterLogger } from "./updater-log";
import { configureAutoUpdater, quitAndInstallArguments } from "./updater-platform";

// electron-updater ships CommonJS; a named import is undefined once the main process is bundled.
const { autoUpdater } = electronUpdater;

const RELEASES_URL = "https://github.com/rafaam11/multi-cli-work/releases/latest";
const REPOSITORY_URL = "https://github.com/rafaam11/multi-cli-work";

let currentStatus: UpdaterStatus = { state: "idle" };
let getWindow: () => MainWindowLike | null = () => null;
let logger: UpdaterLogger | null = null;
let recoveryPending = false;
export function assertUpdaterAvailable():void {if(recoveryPending)throw new Error('v1 복귀 준비 중에는 업데이트를 설치할 수 없습니다.');}
/** Recovery owns the next process exit. A previously downloaded v2 installer
 * must never run from electron-updater's ordinary quit handler. */
export function suspendUpdaterForRecovery(): () => void {
  recoveryPending = true;
  const previous = { autoDownload: autoUpdater.autoDownload, autoInstallOnAppQuit: autoUpdater.autoInstallOnAppQuit };
  autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = false;
  return () => { recoveryPending = false; Object.assign(autoUpdater, previous); };
}

function logsPath(name: string): string {
  return path.join(app.getPath("userData"), "logs", name);
}

function publish(status: UpdaterStatus): void {
  currentStatus = status;
  sendToMainWindow(getWindow(), "updater:event", status);
}

/** The renderer mounts after the first check starts, so it reads the current state instead of waiting for an event. */
export function updaterStatus(): UpdaterStatus {
  return currentStatus;
}

/**
 * Wires autoUpdater and starts one silent check.
 * Development builds have no update feed, so every entry point is a no-op that reports "idle".
 */
export function initUpdater(options: { autoCheck?: boolean; getWindow?: () => MainWindowLike | null } = {}): void {
  if (options.getWindow) getWindow = options.getWindow;
  if (!app.isPackaged) return;
  // Before anything else: a silent install has no window to report from, so this file is the
  // only place a stalled or refused install ever says so.
  logger = createUpdaterLogger(logsPath("updater.log"));
  autoUpdater.logger = logger;
  configureAutoUpdater(autoUpdater);
  if (recoveryPending) { autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = false; }
  const failed = takeInstallAttempt(logsPath("update-attempt.json"), app.getVersion());
  autoUpdater.on("checking-for-update", () => publish({ state: "checking" }));
  autoUpdater.on("update-available", (info: UpdateInfo) => publish({ state: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => publish({ state: "idle" }));
  autoUpdater.on("download-progress", (progress: ProgressInfo) =>
    publish({ state: "downloading", percent: Math.round(progress.percent) }),
  );
  autoUpdater.on("update-downloaded", (info: UpdateInfo) => publish({ state: "downloaded", version: info.version }));
  autoUpdater.on("error", (error: Error) => publish({ state: "error", message: String(error?.message ?? error) }));
  if (failed) {
    logger.warn(`Install of ${failed.to} (started ${failed.at}) did not take effect: still ${app.getVersion()}`);
    // No check this run: it would download the same installer again and hide the failure behind
    // "ready to restart". The next launch checks as usual.
    publish({ state: "installFailed", version: failed.to });
    return;
  }
  if (options.autoCheck !== false && !recoveryPending) void autoUpdater.checkForUpdatesAndNotify();
}

export async function checkForUpdates(): Promise<void> {
  if (recoveryPending) throw new Error("v1 복귀 준비 중에는 업데이트를 시작할 수 없습니다.");
  if (!app.isPackaged || process.env.MCW_RUNTIME === "v2-preview" || app.getVersion().includes("-preview")) {
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
  if (recoveryPending) throw new Error("v1 복귀 준비 중에는 업데이트를 설치할 수 없습니다.");
  if (!app.isPackaged) return;
  // isSilent=true runs the NSIS installer with /S. It also makes quitAndInstall read isForceRunAfter
  // instead of autoRunAppAfterInstall, so both flags must be true for the app to come back up.
  const [isSilent, isForceRunAfter] = quitAndInstallArguments(process.platform);
  if (currentStatus.state === "downloaded") {
    logger?.info(`Install attempt: ${app.getVersion()} -> ${currentStatus.version}`);
    recordInstallAttempt(logsPath("update-attempt.json"), app.getVersion(), currentStatus.version);
  }
  autoUpdater.quitAndInstall(isSilent, isForceRunAfter);
}


export function openReleasesPage(): void {
  void shell.openExternal(RELEASES_URL);
}

export function openRepositoryPage(): void {
  void shell.openExternal(REPOSITORY_URL);
}
