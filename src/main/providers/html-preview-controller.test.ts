// @vitest-environment node

import { pathToFileURL } from "node:url";
import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import { HtmlPreviewController } from "./html-preview-controller";

function fakeView() {
  return {
    show: vi.fn(),
    setBounds: vi.fn(),
    reload: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
}

const BOUNDS = { x: 10, y: 20, width: 300, height: 400 };
const fakeWindow = {} as BrowserWindow;

describe("HtmlPreviewController", () => {
  it("resolves the path and shows a file:// url at the given bounds", async () => {
    const view = fakeView();
    const resolvePath = vi.fn(async () => "D:\\Project\\site\\index.html");
    const controller = new HtmlPreviewController({ view: view as never, getWindow: () => fakeWindow, resolvePath });

    await controller.open("D:\\Project\\site", "index.html", BOUNDS);

    expect(resolvePath).toHaveBeenCalledWith("D:\\Project\\site", "index.html");
    expect(view.show).toHaveBeenCalledWith(fakeWindow, pathToFileURL("D:\\Project\\site\\index.html").href, BOUNDS);
  });

  it("throws when the main window is gone, without touching the view", async () => {
    const view = fakeView();
    const controller = new HtmlPreviewController({
      view: view as never,
      getWindow: () => null,
      resolvePath: vi.fn(async () => "x"),
    });

    await expect(controller.open("root", "a.html", BOUNDS)).rejects.toThrow(/메인 창/);
    expect(view.show).not.toHaveBeenCalled();
  });

  it("propagates a path-resolution rejection without showing the view", async () => {
    const view = fakeView();
    const controller = new HtmlPreviewController({
      view: view as never,
      getWindow: () => fakeWindow,
      resolvePath: vi.fn(async () => {
        throw new Error("Path escapes the project root");
      }),
    });

    await expect(controller.open("root", "../secret.html", BOUNDS)).rejects.toThrow(/escapes/);
    expect(view.show).not.toHaveBeenCalled();
  });

  it("delegates setBounds, reload, and close to the view", () => {
    const view = fakeView();
    const controller = new HtmlPreviewController({
      view: view as never,
      getWindow: () => fakeWindow,
      resolvePath: vi.fn(),
    });

    controller.setBounds(BOUNDS);
    controller.reload();
    controller.close();

    expect(view.setBounds).toHaveBeenCalledWith(BOUNDS);
    expect(view.reload).toHaveBeenCalledOnce();
    expect(view.hide).toHaveBeenCalledOnce();
  });
});
