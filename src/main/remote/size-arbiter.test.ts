// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { TerminalSizeArbiter } from "./size-arbiter";

function arbiter() {
  const apply = vi.fn(async (_id: string, _cols: number, _rows: number) => undefined);
  const sizes = new TerminalSizeArbiter(apply);
  const changes: Array<[string, unknown]> = [];
  sizes.onChange((id, state) => changes.push([id, state]));
  return { apply, sizes, changes };
}

describe("TerminalSizeArbiter", () => {
  it("passes desktop resizes straight through while the desktop owns the size", async () => {
    const { apply, sizes } = arbiter();
    await sizes.desktopResize("s", 120, 40);
    expect(apply).toHaveBeenCalledWith("s", 120, 40);
    expect(sizes.current("s")).toEqual({ cols: 120, rows: 40, owner: "desktop" });
  });

  it("attach alone never resizes: an unknown session reports no size", () => {
    const { apply, sizes } = arbiter();
    expect(sizes.current("s")).toEqual({ cols: null, rows: null, owner: "desktop" });
    expect(apply).not.toHaveBeenCalled();
  });

  it("a device takes the size, and desktop input takes it back at the desktop's last size", async () => {
    const { apply, sizes, changes } = arbiter();
    await sizes.desktopResize("s", 120, 40);
    await sizes.deviceResize("phone", "s", 45, 30);
    expect(sizes.current("s")).toEqual({ cols: 45, rows: 30, owner: "phone" });
    await sizes.desktopInput("s");
    expect(apply).toHaveBeenLastCalledWith("s", 120, 40);
    expect(sizes.current("s").owner).toBe("desktop");
    expect(changes.at(-1)).toEqual(["s", { cols: 120, rows: 40, owner: "desktop" }]);
  });

  it("desktop input is free when the desktop already owns the size", async () => {
    const { apply, sizes } = arbiter();
    await sizes.desktopResize("s", 120, 40);
    apply.mockClear();
    await sizes.desktopInput("s");
    expect(apply).not.toHaveBeenCalled();
  });

  it("a desktop resize reclaims the size from a device", async () => {
    const { sizes } = arbiter();
    await sizes.deviceResize("phone", "s", 45, 30);
    await sizes.desktopResize("s", 100, 30);
    expect(sizes.current("s")).toEqual({ cols: 100, rows: 30, owner: "desktop" });
  });

  it("only the owning device can release, and release restores the desktop size", async () => {
    const { apply, sizes } = arbiter();
    await sizes.desktopResize("s", 120, 40);
    await sizes.deviceResize("phone", "s", 45, 30);
    await sizes.deviceRelease("tablet", "s");
    expect(sizes.current("s").owner).toBe("phone");
    await sizes.deviceRelease("phone", "s");
    expect(apply).toHaveBeenLastCalledWith("s", 120, 40);
    expect(sizes.current("s").owner).toBe("desktop");
  });

  it("release without a known desktop size just hands ownership back", async () => {
    const { apply, sizes } = arbiter();
    await sizes.deviceResize("phone", "s", 45, 30);
    apply.mockClear();
    await sizes.deviceRelease("phone", "s");
    expect(apply).not.toHaveBeenCalled();
    expect(sizes.current("s")).toEqual({ cols: 45, rows: 30, owner: "desktop" });
  });

  it("records a session the host just started without resizing it or handing it to a device", async () => {
    const { apply, sizes, changes } = arbiter();
    sizes.hostStarted("s", 80, 24);
    expect(apply).not.toHaveBeenCalled();
    expect(sizes.current("s")).toEqual({ cols: 80, rows: 24, owner: "desktop" });
    expect(changes.at(-1)).toEqual(["s", { cols: 80, rows: 24, owner: "desktop" }]);
    // 기기가 가져갔다 돌려주면 호스트가 시작한 크기로 돌아온다.
    await sizes.deviceResize("phone", "s", 40, 20);
    await sizes.deviceRelease("phone", "s");
    expect(apply).toHaveBeenLastCalledWith("s", 80, 24);
    expect(sizes.current("s")).toEqual({ cols: 80, rows: 24, owner: "desktop" });
  });

  it("forgets a removed session: releasing it afterwards resizes nothing", async () => {
    const { apply, sizes } = arbiter();
    await sizes.desktopResize("s", 120, 40);
    await sizes.deviceResize("phone", "s", 40, 20);
    sizes.forget("s");
    // 지워진 세션을 보던 화면이 떼어 나오며 크기를 돌려준다 — 되돌릴 PTY가 없다.
    await sizes.deviceRelease("phone", "s");
    expect(apply).toHaveBeenCalledTimes(2);
    expect(sizes.current("s")).toEqual({ cols: null, rows: null, owner: "desktop" });
  });

  it("a failed resize changes nothing", async () => {
    const apply = vi.fn(async () => {
      throw new Error("Terminal dimensions are invalid");
    });
    const sizes = new TerminalSizeArbiter(apply);
    await expect(sizes.deviceResize("phone", "s", 1, 1)).rejects.toThrow();
    expect(sizes.current("s")).toEqual({ cols: null, rows: null, owner: "desktop" });
  });
});
