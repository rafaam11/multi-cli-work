// @vitest-environment node

import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { HostPairing } from "./host-registry";
import {
  REMOTE_SHELL_CHANNELS,
  REMOTE_WINDOW_LOAD_TIMEOUT_MS,
  remoteWindowUrl,
  RemoteWindows,
  type RemoteShellEvent,
} from "./remote-windows";

type Listener = (...args: any[]) => unknown;

function fakeWindow(id: number) {
  const contents = new Map<string, Listener>();
  const windowEvents = new Map<string, Listener>();
  const sessionEvents = new Map<string, Listener>();
  let destroyed = false;
  const close = () => {
    destroyed = true;
    windowEvents.get("closed")?.();
  };
  const session = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    on: vi.fn((name: string, listener: Listener) => sessionEvents.set(name, listener)),
  };
  const window = {
    webContents: {
      id,
      session,
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((name: string, listener: Listener) => contents.set(name, listener)),
    },
    on: vi.fn((name: string, listener: Listener) => windowEvents.set(name, listener)),
    loadURL: vi.fn(async (_url: string) => undefined),
    isDestroyed: () => destroyed,
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(close),
    destroy: vi.fn(close),
  };
  return { window, contents, windowEvents, sessionEvents, session };
}

const PAIRING: HostPairing = { hostId: "host-1", hostName: "회사PC", address: "100.64.0.9:47821", deviceId: "dev-1", token: "tok" };

function setup(pairing: HostPairing | null = PAIRING) {
  const fakes: Array<ReturnType<typeof fakeWindow>> = [];
  const channels = new Map<string, (event: RemoteShellEvent) => void>();
  const createWindow = vi.fn((_options: Electron.BrowserWindowConstructorOptions) => {
    const fake = fakeWindow(100 + fakes.length);
    fakes.push(fake);
    return fake.window as unknown as BrowserWindow;
  });
  const onUnpaired = vi.fn(async (_hostId: string) => undefined);
  const showMainWindow = vi.fn();
  const windows = new RemoteWindows({
    createWindow,
    ipc: { on: (channel, listener) => channels.set(channel, listener) },
    preloadPath: "/out/preload/remote-shell.js",
    pairing: vi.fn(async () => pairing),
    onUnpaired,
    showMainWindow,
  });
  const ask = (channel: string, event: Omit<RemoteShellEvent, "returnValue">) => {
    const full: RemoteShellEvent = { ...event };
    channels.get(channel)!(full);
    return full.returnValue;
  };
  return { windows, fakes, createWindow, onUnpaired, showMainWindow, ask };
}

const HOST_FRAME = { url: "http://100.64.0.9:47821/mobile/", parent: null };

describe("remoteWindowUrl", () => {
  it("points at the host's served UI, optionally at one session", () => {
    expect(remoteWindowUrl("100.64.0.9:47821")).toBe("http://100.64.0.9:47821/mobile/");
    expect(remoteWindowUrl("100.64.0.9:47821", "a b")).toBe("http://100.64.0.9:47821/mobile/#session=a%20b");
  });
});

describe("RemoteWindows", () => {
  it("opens a locked-down window on the host's page", async () => {
    const { windows, fakes, createWindow } = setup();
    await windows.open("host-1");
    const options = createWindow.mock.calls[0]![0];
    expect(options.webPreferences).toEqual({
      preload: "/out/preload/remote-shell.js",
      partition: "remote-host-1",
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    });
    expect(options.title).toBe("회사PC — 원격");
    // 최소 크기는 콘텐츠 기준이어야 한다 — 창 테두리만큼 모자라면 넓은 화면이 폰 화면으로 바뀐다.
    expect(options).toMatchObject({ minWidth: 900, useContentSize: true });
    const fake = fakes[0]!;
    expect(fake.window.loadURL).toHaveBeenCalledWith("http://100.64.0.9:47821/mobile/");
    expect(fake.window.show).toHaveBeenCalled();

    // 다른 출처로는 못 간다.
    const away = { preventDefault: vi.fn() };
    fake.contents.get("will-navigate")!(away, "http://example.com/");
    expect(away.preventDefault).toHaveBeenCalledOnce();
    const stay = { preventDefault: vi.fn() };
    fake.contents.get("will-navigate")!(stay, "http://100.64.0.9:47821/mobile/#session=x");
    expect(stay.preventDefault).not.toHaveBeenCalled();
    const popup = fake.window.webContents.setWindowOpenHandler.mock.calls[0]![0] as () => { action: string };
    expect(popup()).toEqual({ action: "deny" });

    // 권한 요청과 다운로드는 모두 거부한다.
    const callback = vi.fn();
    (fake.session.setPermissionRequestHandler.mock.calls[0]![0] as Listener)({}, "media", callback);
    expect(callback).toHaveBeenCalledWith(false);
    expect((fake.session.setPermissionCheckHandler.mock.calls[0]![0] as Listener)()).toBe(false);
    const download = { preventDefault: vi.fn() };
    fake.sessionEvents.get("will-download")!(download);
    expect(download.preventDefault).toHaveBeenCalledOnce();
  });

  it("hands the token only to the host's own main frame", async () => {
    const { windows, ask } = setup();
    await windows.open("host-1");
    const channel = REMOTE_SHELL_CHANNELS.pairing;
    expect(JSON.parse(String(ask(channel, { sender: { id: 100 }, senderFrame: HOST_FRAME })))).toEqual({
      token: "tok",
      deviceId: "dev-1",
      hostName: "회사PC",
    });
    expect(ask(channel, { sender: { id: 100 }, senderFrame: { url: "http://evil.example/", parent: null } })).toBe("");
    expect(ask(channel, { sender: { id: 100 }, senderFrame: { ...HOST_FRAME, parent: {} } })).toBe("");
    expect(ask(channel, { sender: { id: 100 }, senderFrame: null })).toBe("");
    expect(ask(channel, { sender: { id: 999 }, senderFrame: HOST_FRAME })).toBe("");
  });

  it("refuses a host that needs pairing again", async () => {
    const { windows, createWindow } = setup(null);
    await expect(windows.open("host-1")).rejects.toThrow("다시 페어링");
    expect(createWindow).not.toHaveBeenCalled();
  });

  it("brings the open window forward instead of opening a second one", async () => {
    const { windows, fakes, createWindow } = setup();
    await windows.open("host-1");
    await windows.open("host-1", "s2");
    expect(createWindow).toHaveBeenCalledOnce();
    expect(fakes[0]!.window.loadURL).toHaveBeenLastCalledWith("http://100.64.0.9:47821/mobile/#session=s2");
    expect(fakes[0]!.window.focus).toHaveBeenCalled();
  });

  it("clears the pairing when the page reports it was rejected", async () => {
    const { windows, fakes, onUnpaired, ask } = setup();
    await windows.open("host-1");
    ask(REMOTE_SHELL_CHANNELS.unpaired, { sender: { id: 100 }, senderFrame: { url: "http://evil.example/", parent: null } });
    expect(onUnpaired).not.toHaveBeenCalled();
    ask(REMOTE_SHELL_CHANNELS.unpaired, { sender: { id: 100 }, senderFrame: HOST_FRAME });
    expect(onUnpaired).toHaveBeenCalledWith("host-1");
    expect(fakes[0]!.window.close).toHaveBeenCalled();
    // 닫힌 창은 더 이상 토큰을 받지 못한다.
    expect(ask(REMOTE_SHELL_CHANNELS.pairing, { sender: { id: 100 }, senderFrame: HOST_FRAME })).toBe("");
  });

  it("goes back to the main window on request", async () => {
    const { windows, fakes, showMainWindow, ask } = setup();
    await windows.open("host-1");
    ask(REMOTE_SHELL_CHANNELS.back, { sender: { id: 100 }, senderFrame: HOST_FRAME });
    expect(fakes[0]!.window.close).toHaveBeenCalled();
    expect(showMainWindow).toHaveBeenCalled();
  });

  it("closes the window and says so when the host cannot be reached", async () => {
    const { windows, fakes, createWindow } = setup();
    createWindow.mockImplementationOnce(() => {
      const fake = fakeWindow(100);
      fake.window.loadURL.mockRejectedValueOnce(new Error("ERR_CONNECTION_REFUSED"));
      fakes.push(fake);
      return fake.window as unknown as BrowserWindow;
    });
    await expect(windows.open("host-1")).rejects.toThrow("호스트에 연결하지 못했습니다");
    expect(fakes[0]!.window.destroy).toHaveBeenCalled();
    expect(fakes[0]!.window.show).not.toHaveBeenCalled();
  });

  it("waits for a window that is still loading instead of showing it blank", async () => {
    const { windows, fakes, createWindow } = setup();
    let finishLoad: () => void = () => undefined;
    createWindow.mockImplementationOnce(() => {
      const fake = fakeWindow(100);
      fake.window.loadURL.mockImplementationOnce(
        () =>
          new Promise<undefined>((resolve) => {
            finishLoad = () => resolve(undefined);
          }),
      );
      fakes.push(fake);
      return fake.window as unknown as BrowserWindow;
    });
    const first = windows.open("host-1");
    const second = windows.open("host-1");
    await vi.waitFor(() => expect(createWindow).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakes[0]!.window.show).not.toHaveBeenCalled();
    finishLoad();
    await Promise.all([first, second]);
    expect(createWindow).toHaveBeenCalledOnce();
    expect(fakes[0]!.window.show).toHaveBeenCalled();
  });

  it("gives up on a host that does not answer in time", async () => {
    vi.useFakeTimers();
    try {
      const { windows, fakes, createWindow } = setup();
      createWindow.mockImplementationOnce(() => {
        const fake = fakeWindow(100);
        fake.window.loadURL.mockImplementationOnce(() => new Promise<undefined>(() => undefined));
        fakes.push(fake);
        return fake.window as unknown as BrowserWindow;
      });
      const failed = expect(windows.open("host-1")).rejects.toThrow("호스트에 연결하지 못했습니다");
      await vi.advanceTimersByTimeAsync(REMOTE_WINDOW_LOAD_TIMEOUT_MS);
      await failed;
      expect(fakes[0]!.window.destroy).toHaveBeenCalled();
      // 다음 시도는 새 창으로 한다.
      await windows.open("host-1");
      expect(createWindow).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says nothing when the user closes the window while it loads", async () => {
    const { windows, fakes, createWindow } = setup();
    createWindow.mockImplementationOnce(() => {
      const fake = fakeWindow(100);
      fake.window.destroy.mockImplementation(() => {
        throw new Error("Object has been destroyed");
      });
      fake.window.loadURL.mockImplementationOnce(async () => {
        fake.window.close();
        throw new Error("ERR_ABORTED");
      });
      fakes.push(fake);
      return fake.window as unknown as BrowserWindow;
    });
    await expect(windows.open("host-1")).resolves.toBeUndefined();
    expect(fakes[0]!.window.show).not.toHaveBeenCalled();
  });

  it("closes a host's window, or all of them", async () => {
    const { windows, fakes } = setup();
    await windows.open("host-1");
    windows.closeHost("host-other");
    expect(fakes[0]!.window.close).not.toHaveBeenCalled();
    windows.closeHost("host-1");
    expect(fakes[0]!.window.close).toHaveBeenCalledOnce();
    await windows.open("host-1");
    windows.closeAll();
    expect(fakes[1]!.window.close).toHaveBeenCalledOnce();
  });
});
