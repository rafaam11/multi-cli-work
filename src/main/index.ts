import { app, BrowserWindow, Menu, nativeImage, Tray, dialog } from "electron";
import path from "node:path";
import { createDesktopRuntime, type DesktopRuntime } from "./runtime";
import { trayIconDataUrl } from "./tray-icon";
import { checkForUpdates, initUpdater, quitAndInstall } from "./updater";
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
    title: "멀티 터미널 작업기",
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
  return window;
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
    detail: "이 앱이 관리하는 Codex, Claude, PowerShell 프로세스가 종료됩니다.",
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
  nextTray.setToolTip("멀티 터미널 작업기");
  nextTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "멀티 터미널 작업기 표시", click: showMainWindow },
      { label: "업데이트 확인", click: () => void checkForUpdates() },
      { type: "separator" },
      { label: "종료", click: () => void requestQuit() },
    ]),
  );
  nextTray.on("double-click", showMainWindow);
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
      runtime = await createDesktopRuntime(showMainWindow, installUpdateAndQuit);
      mainWindow = createWindow();
      tray = createTray();
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
