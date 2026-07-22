import { app, BrowserWindow, Menu, nativeImage, Tray, dialog } from "electron";
import path from "node:path";
import { createDesktopRuntime, type DesktopRuntime } from "./runtime";
import { trayIconDataUrl } from "./tray-icon";
import { checkForUpdates, initUpdater, quitAndInstall } from "./updater";
import { APP_WINDOW_TITLE, applyWindowAttention } from "./window-attention";
import { taskbarBadgeSpec, trayTooltip } from "./window-badge";
import type { AttentionSnapshot } from "./attention-policy";
import {
  rendererTargetNavigationUrl,
  resolveRendererTarget,
  secureBrowserWindow,
} from "./window-security";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let runtime: DesktopRuntime | null = null;
let isQuitting = false;
let shouldFocusWhenReady = false;
let quitRequestInProgress = false;
let trayUnavailable = false;
let windowAttention: AttentionSnapshot = { window: "none", unread: {} };

if (process.env.MULTI_CLI_WORK_USER_DATA) {
  app.setPath("userData", path.resolve(process.env.MULTI_CLI_WORK_USER_DATA));
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: "#161918",
    title: APP_WINDOW_TITLE,
    icon: nativeImage.createFromDataURL(trayIconDataUrl(32)),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (trayUnavailable) {
      void requestQuit();
      return;
    }
    window.hide();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });

  const rendererTarget = resolveRendererTarget({
    isPackaged: app.isPackaged,
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
    rendererFilePath: path.join(__dirname, "../renderer/index.html"),
  });
  secureBrowserWindow(window, rendererTargetNavigationUrl(rendererTarget));

  if (rendererTarget.kind === "url") {
    void window.loadURL(rendererTarget.value);
  } else {
    void window.loadFile(rendererTarget.value);
  }
  applyAttentionSnapshot(window, windowAttention);
  return window;
}

function applyAttentionSnapshot(window: BrowserWindow, snapshot: AttentionSnapshot): void {
  if (window.isDestroyed()) return;
  applyWindowAttention(window, snapshot.window);
  const badge = process.platform === "win32" ? taskbarBadgeSpec(snapshot) : null;
  if (badge) {
    const image = nativeImage.createFromBitmap(badge.bitmap, { width: badge.size, height: badge.size });
    image.addRepresentation({
      scaleFactor: 2,
      width: badge.size * 2,
      height: badge.size * 2,
      buffer: badge.bitmap2x,
    });
    window.setOverlayIcon(image, badge.description);
  } else {
    window.setOverlayIcon(null, "");
  }
}

function updateWindowAttention(snapshot: AttentionSnapshot): void {
  windowAttention = snapshot;
  if (mainWindow) applyAttentionSnapshot(mainWindow, snapshot);
  tray?.setToolTip(trayTooltip(snapshot));
}

function showMainWindow(): void {
  if (!runtime) {
    shouldFocusWhenReady = true;
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function confirmStoppingSessions(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (!runtime?.coordinator.hasActiveSessions()) return true;
  showMainWindow();
  const options: Electron.MessageBoxOptions = {
    type: "warning",
    title,
    message,
    detail:
      "이 앱이 관리하는 Codex, Claude, PowerShell 프로세스가 종료됩니다. 다음 실행에서 세션을 열람하면 대화가 자동으로 재개됩니다.",
    buttons: ["취소", confirmLabel],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  const result = mainWindow
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options);
  return result.response === 1;
}

async function requestQuit(): Promise<void> {
  if (!runtime || isQuitting) return;
  if (quitRequestInProgress) return;
  quitRequestInProgress = true;
  try {
    const confirmed = await confirmStoppingSessions(
      "멀티 터미널 작업기 종료",
      "종료하고 실행 중인 모든 세션을 중지할까요?",
      "종료",
    );
    if (!confirmed) return;
    await runtime.dispose();
    isQuitting = true;
    app.quit();
  } finally {
    quitRequestInProgress = false;
  }
}

// The updater must not call quitAndInstall on its own: this app owns PTYs whose state is only
// persisted by runtime.dispose(), so the restart goes through the same teardown as an explicit Quit.
async function installUpdateAndQuit(): Promise<void> {
  if (!runtime || isQuitting) return;
  if (quitRequestInProgress) return;
  quitRequestInProgress = true;
  try {
    const confirmed = await confirmStoppingSessions(
      "업데이트 설치",
      "지금 재시작하여 업데이트를 설치할까요?",
      "재시작",
    );
    if (!confirmed) return;
    await runtime.dispose();
    isQuitting = true;
    quitAndInstall();
  } finally {
    quitRequestInProgress = false;
  }
}

function createTray(): Tray {
  const icon = nativeImage.createFromDataURL(trayIconDataUrl(16));
  icon.addRepresentation({ scaleFactor: 2, dataURL: trayIconDataUrl(32) });
  if (icon.isEmpty()) {
    console.error("Tray icon failed to decode; the tray icon will be invisible.");
  }
  const nextTray = new Tray(icon);
  nextTray.setToolTip(trayTooltip(windowAttention));
  nextTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "멀티 터미널 작업기 표시", click: showMainWindow },
      { label: "업데이트 확인", click: () => void checkForUpdates() },
      { type: "separator" },
      { label: "종료", click: () => void requestQuit() },
    ]),
  );
  if (process.platform === "linux") nextTray.on("click", showMainWindow);
  else nextTray.on("double-click", showMainWindow);
  return nextTray;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  isQuitting = true;
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!runtime || !mainWindow) {
      shouldFocusWhenReady = true;
      return;
    }
    showMainWindow();
  });

  void app.whenReady().then(async () => {
    try {
      runtime = await createDesktopRuntime(showMainWindow, installUpdateAndQuit, updateWindowAttention);
      mainWindow = createWindow();
      try {
        tray = createTray();
      } catch (error) {
        trayUnavailable = true;
        mainWindow.show();
        console.error("Tray creation failed; close will quit instead of hiding the app.", error);
      }
      initUpdater();
      if (shouldFocusWhenReady) showMainWindow();
    } catch (error) {
      await dialog.showMessageBox({
        type: "error",
        title: "멀티 터미널 작업기",
        message: "앱을 시작할 수 없습니다.",
        detail: error instanceof Error ? error.message : String(error),
      });
      app.quit();
      return;
    }

    app.on("activate", () => {
      showMainWindow();
    });
  });

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("window-all-closed", () => {
    // The tray owns app lifetime; explicit Quit is the only normal exit path.
  });
}
