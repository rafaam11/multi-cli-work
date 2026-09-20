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
    close: vi.fn(),
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

    await controller.open("panel-1", "D:\\Project\\site", "index.html", BOUNDS);

    expect(resolvePath).toHaveBeenCalledWith("D:\\Project\\site", "index.html");
    expect(view.show).toHaveBeenCalledWith("panel-1", fakeWindow, pathToFileURL("D:\\Project\\site\\index.html").href, BOUNDS);
  });

  it("throws when the main window is gone, without touching the view", async () => {
    const view = fakeView();
    const controller = new HtmlPreviewController({
      view: view as never,
      getWindow: () => null,
      resolvePath: vi.fn(async () => "x"),
    });

    await expect(controller.open("panel-1", "root", "a.html", BOUNDS)).rejects.toThrow(/메인 창/);
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

    await expect(controller.open("panel-1", "root", "../secret.html", BOUNDS)).rejects.toThrow(/escapes/);
    expect(view.show).not.toHaveBeenCalled();
  });

  it("delegates setBounds, reload, and close to the view", async () => {
    const view = fakeView();
    const controller = new HtmlPreviewController({
      view: view as never,
      getWindow: () => fakeWindow,
      resolvePath: vi.fn(async () => "D:\\Project\\index.html"),
    });

    await controller.open("panel-2", "root", "index.html", BOUNDS);
    controller.setBounds("panel-2", BOUNDS);
    controller.reload("panel-2");
    controller.close("panel-2");

    expect(view.setBounds).toHaveBeenCalledWith("panel-2", BOUNDS);
    expect(view.reload).toHaveBeenCalledWith("panel-2");
    expect(view.close).toHaveBeenCalledWith("panel-2");
  });

  it("keeps two panel ids independent", async () => {
    const view = fakeView();
    const controller = new HtmlPreviewController({
      view: view as never,
      getWindow: () => fakeWindow,
      resolvePath: vi.fn(async (_root, relative) => `D:\\Project\\${relative}`),
    });

    await controller.open("left", "root", "left.html", BOUNDS);
    await controller.open("right", "root", "right.html", { ...BOUNDS, x: 500 });
    controller.close("left");

    expect(view.show.mock.calls.map((call) => call[0])).toEqual(["left", "right"]);
    expect(view.close).toHaveBeenCalledWith("left");
  });

  it("ignores a late path-resolution failure after the panel closes", async () => {
    let reject!: (error: Error) => void;
    const view = fakeView();
    const controller = new HtmlPreviewController({
      view: view as never,
      getWindow: () => fakeWindow,
      resolvePath: () => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }),
    });

    const opening = controller.open("panel-1", "root", "index.html", BOUNDS);
    controller.close("panel-1");
    reject(new Error("late failure"));

    await expect(opening).resolves.toBeUndefined();
    expect(view.show).not.toHaveBeenCalled();
  });

  it("invalidates pending opens when disposed", async () => {
    let resolve!: (path: string) => void;
    const view = fakeView();
    const controller = new HtmlPreviewController({
      view: view as never,
      getWindow: () => fakeWindow,
      resolvePath: () => new Promise((resolvePath) => { resolve = resolvePath; }),
    });

    const opening = controller.open("panel-1", "root", "index.html", BOUNDS);
    controller.dispose();
    resolve("D:\\Project\\index.html");
    await opening;

    expect(view.show).not.toHaveBeenCalled();
    expect(view.dispose).toHaveBeenCalledOnce();
  });
});
