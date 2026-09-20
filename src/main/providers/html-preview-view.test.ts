// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const instances: Array<{
  webContents: { loadURL: ReturnType<typeof vi.fn>; reload: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; setWindowOpenHandler: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> };
  setBackgroundColor: ReturnType<typeof vi.fn>;
  setVisible: ReturnType<typeof vi.fn>;
  setBounds: ReturnType<typeof vi.fn>;
}> = [];

vi.mock("electron", () => ({
  WebContentsView: class {
    webContents = { loadURL: vi.fn(), reload: vi.fn(), close: vi.fn(), setWindowOpenHandler: vi.fn(), on: vi.fn() };
    setBackgroundColor = vi.fn();
    setVisible = vi.fn();
    setBounds = vi.fn();
    constructor() { instances.push(this); }
  },
  shell: { openExternal: vi.fn() },
}));

import { HtmlPreviewView } from "./html-preview-view";

function fakeWindow() {
  return {
    isDestroyed: vi.fn(() => false),
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
  };
}

describe("HtmlPreviewView", () => {
  beforeEach(() => instances.splice(0));

  it("keeps panel views independent and disposes only the closed panel", () => {
    const host = fakeWindow();
    const previews = new HtmlPreviewView();
    previews.show("left", host as never, "file:///left.html", { x: 1, y: 2, width: 300, height: 400 });
    previews.show("right", host as never, "file:///right.html", { x: 501, y: 2, width: 300, height: 400 });

    previews.setBounds("left", { x: 10, y: 20, width: 310, height: 410 });
    previews.close("left");
    previews.reload("right");

    expect(instances).toHaveLength(2);
    expect(instances[0].setBounds).toHaveBeenLastCalledWith({ x: 10, y: 20, width: 310, height: 410 });
    expect(instances[0].webContents.close).toHaveBeenCalledOnce();
    expect(instances[1].webContents.close).not.toHaveBeenCalled();
    expect(instances[1].webContents.reload).toHaveBeenCalledOnce();
    expect(host.contentView.removeChildView).toHaveBeenCalledWith(instances[0]);
  });
});
