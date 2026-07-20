import { pathToFileURL } from "node:url";
import type { BrowserWindow } from "electron";
import type { HtmlPreviewBounds, HtmlPreviewView } from "./html-preview-view";

export interface HtmlPreviewControllerOptions {
  view: HtmlPreviewView;
  /** The main window the embedded view attaches to; null before the window exists. */
  getWindow(): BrowserWindow | null;
  /** Resolves a target root + repo-relative path to an absolute on-disk path, rejecting traversal. */
  resolvePath(rootPath: string, relativePath: string): Promise<string>;
}

/**
 * Turns a workspace file into a `file://` URL and shows it in the embedded preview view. Unlike Git
 * Graph there is no external fallback — a failure to resolve the path is a real error the renderer
 * surfaces, because the source toggle is always there as the plain-text alternative.
 */
export class HtmlPreviewController {
  constructor(private readonly options: HtmlPreviewControllerOptions) {}

  async open(rootPath: string, relativePath: string, bounds: HtmlPreviewBounds): Promise<void> {
    const window = this.options.getWindow();
    if (!window) throw new Error("메인 창을 찾을 수 없습니다");
    const absolutePath = await this.options.resolvePath(rootPath, relativePath);
    this.options.view.show(window, pathToFileURL(absolutePath).href, bounds);
  }

  setBounds(bounds: HtmlPreviewBounds): void {
    this.options.view.setBounds(bounds);
  }

  reload(): void {
    this.options.view.reload();
  }

  close(): void {
    this.options.view.hide();
  }

  dispose(): void {
    this.options.view.dispose();
  }
}
