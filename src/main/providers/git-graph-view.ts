import { BrowserWindow, WebContentsView, shell } from "electron";

export interface GitGraphBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A single WebContentsView that hosts the VS Code for the Web workbench in the main area. It is a
 * sibling of the renderer's own WebContents, so the app's navigation lock never touches it, and it
 * keeps its state (installed Git Graph extension, the open graph) across hide/show by staying
 * attached and toggling visibility rather than being recreated.
 */
export class GitGraphView {
  private view: WebContentsView | null = null;
  private hostWindow: BrowserWindow | null = null;
  private loadedUrl: string | null = null;

  /** Attaches (once) and points the workbench at `url`, then makes the view visible at `bounds`. */
  show(window: BrowserWindow, url: string, bounds: GitGraphBounds | null): void {
    if (!this.view || this.hostWindow !== window) {
      this.detach();
      const view = new WebContentsView({
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      // Git Graph opens external links (commit URLs); send those to the OS browser rather than
      // spawning a child window with no chrome inside the app.
      view.webContents.setWindowOpenHandler(({ url: target }) => {
        if (target.startsWith("http://") || target.startsWith("https://")) void shell.openExternal(target);
        return { action: "deny" };
      });
      window.contentView.addChildView(view);
      this.view = view;
      this.hostWindow = window;
      this.loadedUrl = null;
    }
    if (this.loadedUrl !== url) {
      this.loadedUrl = url;
      void this.view.webContents.loadURL(url);
    }
    this.view.setVisible(true);
    if (bounds) this.setBounds(bounds);
  }

  setBounds(bounds: GitGraphBounds): void {
    this.view?.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    });
  }

  /** Leaves the view attached (state preserved) but off screen. */
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
    this.loadedUrl = null;
  }

  dispose(): void {
    this.detach();
  }
}
