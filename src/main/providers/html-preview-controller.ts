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
  private readonly requests = new Map<string, object>();
  private readonly bounds = new Map<string, HtmlPreviewBounds>();

  constructor(private readonly options: HtmlPreviewControllerOptions) {}

  async open(viewId: string, rootPath: string, relativePath: string, bounds: HtmlPreviewBounds): Promise<void> {
    const request = {};
    this.requests.set(viewId, request);
    this.bounds.set(viewId, bounds);
    this.options.view.close(viewId);
    const window = this.options.getWindow();
    if (!window) {
      this.requests.delete(viewId);
      this.bounds.delete(viewId);
      throw new Error("메인 창을 찾을 수 없습니다");
    }
    let absolutePath: string;
    try {
      absolutePath = await this.options.resolvePath(rootPath, relativePath);
    } catch (error) {
      if (this.requests.get(viewId) !== request) return;
      this.requests.delete(viewId);
      this.bounds.delete(viewId);
      throw error;
    }
    if (this.requests.get(viewId) !== request) return;
    this.options.view.show(viewId, window, pathToFileURL(absolutePath).href, this.bounds.get(viewId) ?? bounds);
  }

  setBounds(viewId: string, bounds: HtmlPreviewBounds): void {
    if (!this.requests.has(viewId)) return;
    this.bounds.set(viewId, bounds);
    this.options.view.setBounds(viewId, bounds);
  }

  reload(viewId: string): void {
    this.options.view.reload(viewId);
  }

  close(viewId: string): void {
    this.requests.delete(viewId);
    this.bounds.delete(viewId);
    this.options.view.close(viewId);
  }

  dispose(): void {
    this.requests.clear();
    this.bounds.clear();
    this.options.view.dispose();
  }
}
