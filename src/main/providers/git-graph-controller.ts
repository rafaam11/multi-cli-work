import type { BrowserWindow } from "electron";
import type { GitGraphOpenResult } from "../../shared/api-types";
import { CodeServeWebManager } from "./code-serve-web";
import { GitGraphView, type GitGraphBounds } from "./git-graph-view";

export interface GitGraphControllerOptions {
  serveWeb: CodeServeWebManager;
  view: GitGraphView;
  /** The main window the embedded view attaches to; null before the window exists. */
  getWindow(): BrowserWindow | null;
  /** Fallback when embedding is impossible: open the folder in an external VS Code window. */
  openExternal(rootPath: string): Promise<void>;
}

/**
 * Ties the serve-web server to the embedded view. `open` tries to embed the real Git Graph and, on
 * any failure (VS Code missing, server never ready, no window), falls back to an external VS Code
 * window so the button always does *something* the user asked for.
 */
export class GitGraphController {
  constructor(private readonly options: GitGraphControllerOptions) {}

  async open(rootPath: string, bounds: GitGraphBounds | null): Promise<GitGraphOpenResult> {
    const window = this.options.getWindow();
    if (!window) {
      return this.fallback(rootPath, "메인 창을 찾을 수 없습니다");
    }
    try {
      const endpoint = await this.options.serveWeb.ensure();
      const url = this.options.serveWeb.folderUrl(endpoint, rootPath);
      this.options.view.show(window, url, bounds);
      return { mode: "embedded" };
    } catch (error) {
      return this.fallback(rootPath, error instanceof Error ? error.message : String(error));
    }
  }

  setBounds(bounds: GitGraphBounds): void {
    this.options.view.setBounds(bounds);
  }

  close(): void {
    this.options.view.hide();
  }

  dispose(): void {
    this.options.view.dispose();
    this.options.serveWeb.dispose();
  }

  private async fallback(rootPath: string, reason: string): Promise<GitGraphOpenResult> {
    // The embedded view must not linger behind the fallback's external window.
    this.options.view.hide();
    try {
      await this.options.openExternal(rootPath);
      return { mode: "external", reason };
    } catch (error) {
      return { mode: "unavailable", reason: error instanceof Error ? error.message : reason };
    }
  }
}
