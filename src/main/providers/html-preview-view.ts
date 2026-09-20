import { BrowserWindow, WebContentsView, shell } from "electron";

export interface HtmlPreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Sandboxed WebContentsViews that render workspace html files as real browser pages —
 * relative CSS/JS/images resolve against the file's own folder, exactly as opening it in a browser
 * would. It is a sibling of the renderer's WebContents (never inheriting its preload or origin), and
 * separate instances from the Git Graph view so the surfaces never fight. Each panel owns one view,
 * and closing a panel detaches and destroys that view.
 */
export class HtmlPreviewView {
  private readonly views = new Map<string, { view: WebContentsView; hostWindow: BrowserWindow }>();

  /** Attaches (once), loads `url` fresh, and makes the view visible at `bounds`. */
  show(viewId: string, window: BrowserWindow, url: string, bounds: HtmlPreviewBounds | null): void {
    let entry = this.views.get(viewId);
    if (!entry || entry.hostWindow !== window) {
      this.close(viewId);
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
      entry = { view, hostWindow: window };
      this.views.set(viewId, entry);
    }
    // Always reload: re-entering the preview after editing the source must show the saved file.
    void entry.view.webContents.loadURL(url);
    entry.view.setVisible(true);
    if (bounds) this.setBounds(viewId, bounds);
  }

  reload(viewId: string): void {
    this.views.get(viewId)?.view.webContents.reload();
  }

  setBounds(viewId: string, bounds: HtmlPreviewBounds): void {
    this.views.get(viewId)?.view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    });
  }

  close(viewId: string): void {
    const entry = this.views.get(viewId);
    if (!entry) return;
    if (!entry.hostWindow.isDestroyed()) {
      entry.hostWindow.contentView.removeChildView(entry.view);
    }
    entry.view.webContents.close();
    this.views.delete(viewId);
  }

  dispose(): void {
    for (const viewId of [...this.views.keys()]) this.close(viewId);
  }
}
