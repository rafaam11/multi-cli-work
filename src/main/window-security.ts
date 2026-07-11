import type { BrowserWindow } from "electron";
import { pathToFileURL } from "node:url";

export const RENDERER_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* ws://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
].join("; ");

export type RendererTarget =
  | { kind: "url"; value: string }
  | { kind: "file"; value: string };

export function isLoopbackRendererUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return false;

    return (
      url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
    );
  } catch {
    return false;
  }
}

export function resolveRendererTarget(options: {
  isPackaged: boolean;
  rendererUrl?: string;
  rendererFilePath: string;
}): RendererTarget {
  if (
    !options.isPackaged &&
    options.rendererUrl &&
    isLoopbackRendererUrl(options.rendererUrl)
  ) {
    return { kind: "url", value: new URL(options.rendererUrl).href };
  }

  return { kind: "file", value: options.rendererFilePath };
}

export function rendererTargetNavigationUrl(target: RendererTarget): string {
  return target.kind === "url" ? target.value : pathToFileURL(target.value).href;
}

export function isAllowedRendererNavigation(
  navigationUrl: string,
  loadedAppUrl: string,
): boolean {
  try {
    const navigation = new URL(navigationUrl);
    const loadedApp = new URL(loadedAppUrl);

    if (loadedApp.protocol === "http:" || loadedApp.protocol === "https:") {
      return (
        isLoopbackRendererUrl(loadedApp.href) &&
        isLoopbackRendererUrl(navigation.href) &&
        navigation.origin === loadedApp.origin
      );
    }

    if (loadedApp.protocol === "file:") {
      return (
        navigation.protocol === "file:" &&
        navigation.host === loadedApp.host &&
        navigation.pathname === loadedApp.pathname
      );
    }

    return false;
  } catch {
    return false;
  }
}

export function secureBrowserWindow(
  window: BrowserWindow,
  loadedAppUrl: string,
): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  const preventExternalNavigation = (
    event: Electron.Event,
    navigationUrl: string,
  ): void => {
    if (!isAllowedRendererNavigation(navigationUrl, loadedAppUrl)) {
      event.preventDefault();
    }
  };

  window.webContents.on("will-navigate", preventExternalNavigation);
  window.webContents.on("will-redirect", preventExternalNavigation);
}
