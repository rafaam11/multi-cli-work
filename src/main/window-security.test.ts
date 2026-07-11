import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  RENDERER_CONTENT_SECURITY_POLICY,
  isAllowedRendererNavigation,
  isLoopbackRendererUrl,
  resolveRendererTarget,
  secureBrowserWindow,
} from "./window-security";

describe("isLoopbackRendererUrl", () => {
  it.each([
    "http://localhost:5173",
    "https://localhost/app",
    "http://127.0.0.1:5173",
    "http://127.12.34.56:5173",
    "http://[::1]:5173",
  ])("accepts the loopback HTTP(S) URL %s", (value) => {
    expect(isLoopbackRendererUrl(value)).toBe(true);
  });

  it.each([
    "https://example.com",
    "http://localhost.example.com",
    "http://0.0.0.0:5173",
    "http://127.999.999.999:5173",
    "http://127.256.0.1:5173",
    "file:///tmp/index.html",
    "javascript:alert(1)",
    "not a url",
    "http://user:password@localhost:5173",
  ])("rejects the non-loopback renderer URL %s", (value) => {
    expect(isLoopbackRendererUrl(value)).toBe(false);
  });
});

describe("resolveRendererTarget", () => {
  const rendererFilePath = "C:\\app\\out\\renderer\\index.html";

  it("uses a validated loopback dev server only in an unpackaged app", () => {
    expect(
      resolveRendererTarget({
        isPackaged: false,
        rendererUrl: "http://localhost:5173/",
        rendererFilePath,
      }),
    ).toEqual({ kind: "url", value: "http://localhost:5173/" });
  });

  it("ignores a renderer URL in a packaged app", () => {
    expect(
      resolveRendererTarget({
        isPackaged: true,
        rendererUrl: "http://localhost:5173/",
        rendererFilePath,
      }),
    ).toEqual({ kind: "file", value: rendererFilePath });
  });

  it("falls back to the local renderer for an untrusted dev URL", () => {
    expect(
      resolveRendererTarget({
        isPackaged: false,
        rendererUrl: "https://example.com/app",
        rendererFilePath,
      }),
    ).toEqual({ kind: "file", value: rendererFilePath });
  });
});

describe("isAllowedRendererNavigation", () => {
  it("allows navigation within the validated dev origin", () => {
    expect(
      isAllowedRendererNavigation(
        "http://localhost:5173/settings#terminal",
        "http://localhost:5173/",
      ),
    ).toBe(true);
  });

  it("allows hash changes on the packaged renderer file", () => {
    expect(
      isAllowedRendererNavigation(
        "file:///C:/app/out/renderer/index.html#terminal",
        "file:///C:/app/out/renderer/index.html",
      ),
    ).toBe(true);
  });

  it.each([
    "https://example.com/",
    "javascript:alert(1)",
    "file:///C:/app/out/renderer/other.html",
  ])("rejects navigation away from the loaded app: %s", (value) => {
    expect(
      isAllowedRendererNavigation(
        value,
        "file:///C:/app/out/renderer/index.html",
      ),
    ).toBe(false);
  });
});

describe("secureBrowserWindow", () => {
  it("denies popup windows and blocks external navigation and redirects", () => {
    const listeners = new Map<string, (event: Electron.Event, url: string) => void>();
    const setWindowOpenHandler = vi.fn();
    const on = vi.fn(
      (eventName: string, listener: (event: Electron.Event, url: string) => void) => {
        listeners.set(eventName, listener);
      },
    );
    const window = {
      webContents: { setWindowOpenHandler, on },
    } as unknown as Electron.BrowserWindow;

    secureBrowserWindow(window, "http://localhost:5173/");

    const popupHandler = setWindowOpenHandler.mock.calls[0]?.[0] as () => {
      action: string;
    };
    expect(popupHandler()).toEqual({ action: "deny" });
    expect(listeners.has("will-navigate")).toBe(true);
    expect(listeners.has("will-redirect")).toBe(true);

    const externalEvent = { preventDefault: vi.fn() } as unknown as Electron.Event;
    listeners.get("will-navigate")?.(externalEvent, "https://example.com/");
    expect(externalEvent.preventDefault).toHaveBeenCalledOnce();

    const redirectEvent = { preventDefault: vi.fn() } as unknown as Electron.Event;
    listeners.get("will-redirect")?.(redirectEvent, "file:///C:/other.html");
    expect(redirectEvent.preventDefault).toHaveBeenCalledOnce();

    const internalEvent = { preventDefault: vi.fn() } as unknown as Electron.Event;
    listeners.get("will-navigate")?.(internalEvent, "http://localhost:5173/settings");
    expect(internalEvent.preventDefault).not.toHaveBeenCalled();
  });
});

describe("renderer CSP", () => {
  it("blocks remote scripts and frames while allowing xterm inline styles", () => {
    expect(RENDERER_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(RENDERER_CONTENT_SECURITY_POLICY).toContain("script-src 'self'");
    expect(RENDERER_CONTENT_SECURITY_POLICY).toContain(
      "style-src 'self' 'unsafe-inline'",
    );
    expect(RENDERER_CONTENT_SECURITY_POLICY).toContain("frame-src 'none'");
    expect(RENDERER_CONTENT_SECURITY_POLICY).not.toContain(
      "script-src 'self' 'unsafe-inline'",
    );
    expect(RENDERER_CONTENT_SECURITY_POLICY).not.toMatch(/https?:\/\/(?!localhost|127\.)/);
  });

  it("keeps the renderer HTML meta policy in sync", () => {
    const html = readFileSync(resolve("src/renderer/index.html"), "utf8");
    expect(html).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${RENDERER_CONTENT_SECURITY_POLICY}" />`,
    );
  });
});
