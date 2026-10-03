import type { BrowserWindow, BrowserWindowConstructorOptions, Session } from "electron";
import { isSameOriginNavigation, secureBrowserWindow } from "../window-security";
import type { HostPairing } from "./host-registry";

/** preload(src/preload/remote-shell.ts)와 맞춘 채널. 그 파일은 electron만 import하므로 문자열을 따로 적는다. */
export const REMOTE_SHELL_CHANNELS = {
  pairing: "remote-shell:pairing",
  unpaired: "remote-shell:unpaired",
  back: "remote-shell:back",
} as const;

/** ipcMain 이벤트에서 여기서 보는 부분. */
export interface RemoteShellEvent {
  sender: { id: number };
  senderFrame: { url: string; parent: unknown } | null;
  returnValue?: unknown;
}

export interface RemoteWindowsOptions {
  createWindow(options: BrowserWindowConstructorOptions): BrowserWindow;
  ipc: { on(channel: string, listener: (event: RemoteShellEvent) => void): unknown };
  /** out/preload/remote-shell.js */
  preloadPath: string;
  pairing(hostId: string): Promise<HostPairing | null>;
  /** 호스트가 이 기기의 토큰을 거절했다. */
  onUnpaired(hostId: string): Promise<void>;
  showMainWindow(): void;
}

interface OpenWindow {
  hostId: string;
  origin: string;
  /** 브리지가 동기로 달라고 하므로 창을 열 때 만들어 둔다. */
  pairingJson: string;
  window: BrowserWindow;
}

const UNREACHABLE = "호스트에 연결하지 못했습니다. 그 PC의 앱이 켜져 있는지와 Tailscale 연결을 확인하세요";

/** 응답 없는 호스트를 기다리는 한도. 꺼진 Tailscale 기기는 TCP 타임아웃까지 수십 초를 끈다. */
export const REMOTE_WINDOW_LOAD_TIMEOUT_MS = 15_000;

export function remoteWindowUrl(address: string, sessionId?: string): string {
  return `http://${address}/mobile/${sessionId ? `#session=${encodeURIComponent(sessionId)}` : ""}`;
}

/**
 * 다른 PC가 서빙한 세션 화면을 띄우는 창들. 호스트마다 하나다. 그 페이지는 이 PC의 것이 아니므로
 * 샌드박스에 가두고, 자기 호스트 밖으로 못 나가게 하고, 토큰은 그 호스트의 메인 프레임에만 준다.
 */
export class RemoteWindows {
  /** webContents id → 창. */
  private readonly windows = new Map<number, OpenWindow>();
  /** hostId → 아직 로드 중인 창. 그동안 다시 열려는 요청은 이 결과를 같이 기다린다. */
  private readonly loading = new Map<string, Promise<void>>();
  private readonly securedSessions = new WeakSet<Session>();

  constructor(private readonly options: RemoteWindowsOptions) {
    options.ipc.on(REMOTE_SHELL_CHANNELS.pairing, (event) => {
      event.returnValue = this.trusted(event)?.pairingJson ?? "";
    });
    options.ipc.on(REMOTE_SHELL_CHANNELS.unpaired, (event) => {
      const entry = this.trusted(event);
      if (!entry) return;
      this.closeWindow(entry);
      void this.options.onUnpaired(entry.hostId).catch(() => undefined);
    });
    options.ipc.on(REMOTE_SHELL_CHANNELS.back, (event) => {
      const entry = this.trusted(event);
      if (!entry) return;
      this.closeWindow(entry);
      this.options.showMainWindow();
    });
  }

  async open(hostId: string, sessionId?: string): Promise<void> {
    const pairing = await this.options.pairing(hostId);
    if (!pairing) throw new Error("이 PC는 다시 페어링해야 합니다");
    // 로드가 끝나지 않은 창을 빈 채로 내보이지 않는다 — 먼저 연 쪽의 결과(실패 포함)를 같이 받는다.
    // 기다릴 것이 없을 때는 await하지 않는다: 그 한 틱 사이에 다른 호출이 끼어들어 같은 창을 찾는다.
    for (let pending = this.loading.get(hostId); pending; pending = this.loading.get(hostId)) await pending;
    const url = remoteWindowUrl(pairing.address, sessionId);
    const existing = [...this.windows.values()].find((entry) => entry.hostId === hostId && !entry.window.isDestroyed());
    if (existing) {
      // 같은 문서에서 해시만 바뀐다 — 웹 UI가 hashchange로 그 세션을 연다.
      if (sessionId) await existing.window.loadURL(url).catch(() => undefined);
      if (existing.window.isMinimized()) existing.window.restore();
      existing.window.show();
      existing.window.focus();
      return;
    }

    const loading = this.load(hostId, pairing, url);
    this.loading.set(hostId, loading);
    try {
      await loading;
    } finally {
      if (this.loading.get(hostId) === loading) this.loading.delete(hostId);
    }
  }

  private async load(hostId: string, pairing: HostPairing, url: string): Promise<void> {
    const window = this.options.createWindow({
      width: 1200,
      height: 800,
      minWidth: 900,
      minHeight: 600,
      show: false,
      backgroundColor: "#101214",
      title: `${pairing.hostName} — 원격`,
      webPreferences: {
        preload: this.options.preloadPath,
        partition: `remote-${hostId}`,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
      },
    });
    const contents = window.webContents;
    const id = contents.id;
    const origin = new URL(url).origin;
    this.windows.set(id, {
      hostId,
      origin,
      pairingJson: JSON.stringify({ token: pairing.token, deviceId: pairing.deviceId, hostName: pairing.hostName }),
      window,
    });
    window.on("closed", () => this.windows.delete(id));
    // 어느 PC의 창인지가 제목이다 — 페이지의 <title>이 덮어쓰지 못하게 한다.
    window.on("page-title-updated", (event) => event.preventDefault());
    secureBrowserWindow(window, origin, isSameOriginNavigation);
    this.secureSession(contents.session);

    const loaded = window.loadURL(url);
    // 시간 초과로 먼저 포기한 뒤에 늦게 오는 실패는 받을 곳이 없다.
    loaded.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("load timed out")), REMOTE_WINDOW_LOAD_TIMEOUT_MS);
    });
    try {
      await Promise.race([loaded, timedOut]);
    } catch {
      // 기다리다 사용자가 창을 닫았으면 알릴 것이 없다.
      if (window.isDestroyed()) return;
      window.destroy();
      this.windows.delete(id);
      throw new Error(UNREACHABLE);
    } finally {
      clearTimeout(timer);
    }
    if (!window.isDestroyed()) window.show();
  }

  closeHost(hostId: string): void {
    for (const entry of [...this.windows.values()]) {
      if (entry.hostId === hostId) this.closeWindow(entry);
    }
  }

  closeAll(): void {
    for (const entry of [...this.windows.values()]) this.closeWindow(entry);
  }

  private closeWindow(entry: OpenWindow): void {
    if (!entry.window.isDestroyed()) entry.window.close();
  }

  /** 요청한 쪽이 열려 있는 원격 창의 메인 프레임이고, 그 창에 등록된 호스트 출처일 때만 창을 돌려준다. */
  private trusted(event: RemoteShellEvent): OpenWindow | null {
    const entry = this.windows.get(event.sender.id);
    const frame = event.senderFrame;
    if (!entry || !frame || frame.parent !== null) return null;
    try {
      return new URL(frame.url).origin === entry.origin ? entry : null;
    } catch {
      return null;
    }
  }

  private secureSession(session: Session): void {
    if (this.securedSessions.has(session)) return;
    this.securedSessions.add(session);
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    // 호스트는 /shell.apk도 서빙한다 — 이 창에서는 아무것도 내려받지 않는다.
    session.on("will-download", (event) => event.preventDefault());
  }
}
