import { app, BrowserWindow, Menu, nativeImage, Tray, dialog } from "electron";
import path from "node:path";
import type { DesktopRuntime, DesktopWindowHost } from "./runtime";
import os from "node:os";
import { prepareV2Data, v2RegistryEnvironment } from "./v2/bootstrap";
import { startDesktopHost, preserveRecoveryRuntime } from "./v2/desktop-host";
import { trayIconDataUrl } from "./tray-icon";
import { checkForUpdates, initUpdater, quitAndInstall } from "./updater";
import { APP_WINDOW_TITLE, applyWindowAttention } from "./window-attention";
import { taskbarBadgeSpec, trayTooltip } from "./window-badge";
import type { AttentionSnapshot } from "./attention-policy";
import type { WindowChromeState } from "../shared/api-types";
import { QuitCoordinator } from "./quit-coordinator";
import { windowChromeOptions } from "./window-chrome";
import {
  rendererTargetNavigationUrl,
  resolveRendererTarget,
  secureBrowserWindow,
} from "./window-security";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let runtime: DesktopRuntime | null = null;
let shouldFocusWhenReady = false;
let trayUnavailable = false;
let windowAttention: AttentionSnapshot = { window: "none", unread: {} };
const v2Enabled = process.env.MCW_RUNTIME === "v2-preview" || /^2\./.test(app.getVersion());
let v2Host: DesktopWindowHost["v2"];
const quitCoordinator = new QuitCoordinator(async () => {
  await runtime?.dispose();
});

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
    ...windowChromeOptions(process.platform),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: v2Enabled ? ["--mcw-v2"] : [],
      // 원격 창이 보낸 그리드 조작은 이 렌더러가 처리한다 — 창이 가려져 있어도 늦지 않게.
      backgroundThrottling: false,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.on("focus", () => {
    void runtime?.markMobileVisibleSeen().catch(error => console.error("Failed to sync mobile seen state", error));
  });
  // The renderer draws the maximize/restore glyph itself, so it has to hear about every state
  // change — including the ones it did not ask for (double-click on the drag region, Win+Up, a
  // window manager tiling the app).
  const publishChromeState = () => {
    if (window.isDestroyed()) return;
    window.webContents.send("window:state", {
      maximized: window.isMaximized(),
      fullScreen: window.isFullScreen(),
    } satisfies WindowChromeState);
  };
  window.on("maximize", publishChromeState);
  window.on("unmaximize", publishChromeState);
  window.on("enter-full-screen", publishChromeState);
  window.on("leave-full-screen", publishChromeState);
  window.on("close", (event) => {
    if (quitCoordinator.isCommitted()) return;
    event.preventDefault();
    const closeToTray = runtime?.settings.current().general.closeToTray ?? true;
    if (trayUnavailable || !closeToTray) {
      void requestQuit();
      return;
    }
    window.hide();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  if (process.platform === "win32") {
    window.on("session-end", () => {
      try {
        runtime?.writeRecoveryMarker();
      } catch (error) {
        console.error("Failed to write the shutdown recovery marker", error);
      }
    });
  }

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

function restoreMainWindow(): void {
  showMainWindow();
  void runtime?.markVisibleSessionsSeen().catch((error) =>
    console.error("Failed to mark restored terminal sessions as seen", error),
  );
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
  if (!runtime || quitCoordinator.isCommitted()) return;
  await quitCoordinator.request({
    confirm: () => v2Enabled ? Promise.resolve(true) : confirmStoppingSessions(
      "멀티 터미널 작업기 종료",
      "종료하고 실행 중인 모든 세션을 중지할까요?",
      "종료",
    ),
    exit: () => app.quit(),
  });
}

// The updater must not call quitAndInstall on its own: this app owns PTYs whose state is only
// persisted by runtime.dispose(), so the restart goes through the same teardown as an explicit Quit.
async function installUpdateAndQuit(): Promise<void> {
  if (!runtime || quitCoordinator.isCommitted()) return;
  await quitCoordinator.request({
    confirm: () => confirmStoppingSessions(
      "업데이트 설치",
      "지금 재시작하여 업데이트를 설치할까요?",
      "재시작",
    ),
    exit: quitAndInstall,
  });
}

async function snoozeNotifications(durationMs: number): Promise<void> {
  const snoozedUntil = durationMs > 0 ? new Date(Date.now() + durationMs).toISOString() : null;
  await runtime?.updateSettings({ notifications: { snoozedUntil } }).catch((error) =>
    console.error("Failed to change the notification snooze", error),
  );
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
      { label: "멀티 터미널 작업기 표시", click: restoreMainWindow },
      { label: "업데이트 확인", click: () => void checkForUpdates() },
      { type: "separator" },
      // 회의 중처럼 잠깐 조용해야 할 때. 배지·트레이 표시는 그대로고 데스크톱 알림만 멈춘다.
      { label: "알림 1시간 끄기", click: () => void snoozeNotifications(60 * 60_000) },
      { label: "알림 다시 켜기", click: () => void snoozeNotifications(0) },
      { type: "separator" },
      { label: "종료", click: () => void requestQuit() },
    ]),
  );
  if (process.platform === "linux") nextTray.on("click", restoreMainWindow);
  else nextTray.on("double-click", restoreMainWindow);
  return nextTray;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!runtime || !mainWindow) {
      shouldFocusWhenReady = true;
      return;
    }
    restoreMainWindow();
  });

  void app.whenReady().then(async () => {
    // The renderer draws its own menu bar; Electron's default one would only stack a second,
    // English row on top of it. The tray still builds a menu of its own.
    Menu.setApplicationMenu(null);
    try {
      if (v2Enabled) {
        const v1UserData = app.getPath("userData");
        const prepared = await prepareV2Data({v1UserData, v1Registry: process.env.MCW_V1_REGISTRY ?? path.join(os.homedir(), ".multi-cli-work"), v1ClaudeConfig:process.env.MULTI_CLI_WORK_CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(),".claude"), recoveryRoot: process.env.MCW_RECOVERY_ROOT ?? `${v1UserData}-recovery`,
          assertStopped: async () => {if (!hasSingleInstanceLock || runtime) throw new Error("v1 종료를 확인하지 못했습니다.");}});
        app.setPath("userData", prepared.userData);
        Object.assign(process.env, v2RegistryEnvironment(prepared.registry));
        const sourceRoot = path.resolve(__dirname,"../..");
        const resourcesDirectory = app.isPackaged ? path.join(process.resourcesPath,"v2") : path.join(sourceRoot,"build/v2");
        const bridgeDirectory = app.isPackaged ? path.join(process.resourcesPath,"herdr-bridge") : path.join(sourceRoot,`build/herdr-bridge/${process.platform}-${process.arch}`);
        await preserveRecoveryRuntime(resourcesDirectory, prepared.recoveryRoot, path.dirname(process.execPath), app.isPackaged ? path.join(process.resourcesPath,"recovery-scripts") : path.join(sourceRoot,"scripts/recovery"));
        v2Host = {...await startDesktopHost({userData:prepared.userData,registryRoot:prepared.registry,resourcesDirectory,bridgeDirectory,entryPath:path.join(resourcesDirectory,"host/mcw-host.js")}),backupDirectory:prepared.backupDirectory};
      }
      const {createDesktopRuntime} = await import("./runtime");
      runtime = await createDesktopRuntime(showMainWindow, installUpdateAndQuit, updateWindowAttention, {
        // Lazy: the runtime is constructed before the window exists (the next line).
        getMainWindow: () => mainWindow,
        requestQuit,
        v2: v2Host,
      });
      mainWindow = createWindow();
      try {
        tray = createTray();
      } catch (error) {
        trayUnavailable = true;
        mainWindow.show();
        console.error("Tray creation failed; close will quit instead of hiding the app.", error);
      }
      initUpdater({
        autoCheck: !v2Enabled && (runtime?.settings.current().general.autoCheckUpdates ?? true),
        getWindow: () => mainWindow,
      });
      if (shouldFocusWhenReady) showMainWindow();
    } catch (error) {
      console.error("Desktop startup failed", error);
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
      restoreMainWindow();
    });
  });

  app.on("before-quit", (event) => {
    if (!runtime || quitCoordinator.isCommitted()) return;
    event.preventDefault();
    void requestQuit();
  });

  app.on("window-all-closed", () => {
    // The tray owns app lifetime; explicit Quit is the only normal exit path.
  });
}
