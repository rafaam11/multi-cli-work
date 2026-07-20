import { BrowserWindow, WebContentsView, shell } from "electron";

export interface HtmlPreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A single sandboxed WebContentsView that renders a workspace html file as a real browser page —
 * relative CSS/JS/images resolve against the file's own folder, exactly as opening it in a browser
 * would. It is a sibling of the renderer's WebContents (never inheriting its preload or origin), and
 * a separate instance from the Git Graph view so the two never fight over one surface. Kept attached
 * across hide/show; only its visibility and loaded url change.
 */
export class HtmlPreviewView {
  private view: WebContentsView | null = null;
  private hostWindow: BrowserWindow | null = null;

  /** Attaches (once), loads `url` fresh, and makes the view visible at `bounds`. */
  show(window: BrowserWindow, url: string, bounds: HtmlPreviewBounds | null): void {
    if (!this.view || this.hostWindow !== window) {
      this.detach();
      const view = new WebContentsView({
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      // Local html often assumes a page background; without this the view is transparent and the
      // status text behind it bleeds through before the page paints.
      view.setBackgroundColor("#ffffff");
      // window.open / target=_blank to the web goes to the OS browser, never a chromeless child.
      view.webContents.setWindowOpenHandler(({ url: target }) => {
        if (target.startsWith("http://") || target.startsWith("https://")) void shell.openExternal(target);
        return { action: "deny" };
      });
      // Clicking a remote link navigates the OS browser; local (file://) links stay in the preview,
      // so relative navigation between pages works like a browser.
      view.webContents.on("will-navigate", (event, target) => {
        if (target.startsWith("http://") || target.startsWith("https://")) {
          event.preventDefault();
          void shell.openExternal(target);
        }
      });
      window.contentView.addChildView(view);
      this.view = view;
      this.hostWindow = window;
    }
    // Always reload: re-entering the preview after editing the source must show the saved file.
    void this.view.webContents.loadURL(url);
    this.view.setVisible(true);
    if (bounds) this.setBounds(bounds);
  }

  reload(): void {
    this.view?.webContents.reload();
  }

  setBounds(bounds: HtmlPreviewBounds): void {
    this.view?.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    });
  }

  /** Leaves the view attached but off screen (e.g. when the user toggles to the source view). */
  hide(): void {
    this.view?.setVisible(false);
  }

  private detach(): void {
    if (!this.view) return;
    if (this.hostWindow && !this.hostWindow.isDestroyed()) {
      this.hostWindow.contentView.removeChildView(this.view);
    }
    this.view.webContents.close();
    this.view = null;
    this.hostWindow = null;
  }

  dispose(): void {
    this.detach();
  }
}
