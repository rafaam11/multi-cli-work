import { app, BrowserWindow, Menu, nativeImage, Tray, dialog } from "electron";
import path from "node:path";
import { createDesktopRuntime, type DesktopRuntime } from "./runtime";
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
    title: "Multi CLI Work",
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

async function requestQuit(): Promise<void> {
  if (!runtime || isQuitting) return;
  if (runtime.coordinator.hasActiveSessions()) {
    const options: Electron.MessageBoxOptions = {
      type: "warning",
      title: "Quit Multi CLI Work",
      message: "Quit and stop all running sessions?",
      detail: "Open Codex, Claude, and PowerShell processes managed by this app will be terminated.",
      buttons: ["Cancel", "Quit"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    if (result.response !== 1) return;
  }
  await runtime.dispose();
  isQuitting = true;
  app.quit();
}

function createTray(): Tray {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="#202524"/><path d="M8 10l5 5-5 5M16 21h8" fill="none" stroke="#4fb7a4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const icon = nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)
    .resize({ width: 16, height: 16 });
  const nextTray = new Tray(icon);
  nextTray.setToolTip("Multi CLI Work");
  nextTray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show Multi CLI Work", click: showMainWindow },
      { type: "separator" },
      { label: "Quit", click: () => void requestQuit() },
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
      runtime = await createDesktopRuntime(showMainWindow);
      mainWindow = createWindow();
      tray = createTray();
      if (shouldFocusWhenReady) showMainWindow();
    } catch (error) {
      await dialog.showMessageBox({
        type: "error",
        title: "Multi CLI Work",
        message: "The app could not start.",
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
