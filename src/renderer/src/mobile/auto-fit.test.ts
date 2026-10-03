import { describe, expect, it, vi } from "vitest";
import { createAutoFit, type AutoFitState } from "./auto-fit";

function setup() {
  let size: { cols: number; rows: number } | null = { cols: 120, rows: 40 };
  const resize = vi.fn();
  const release = vi.fn();
  const states: AutoFitState[] = [];
  const fit = createAutoFit({
    deviceId: "me",
    measure: () => size,
    resize,
    release,
    onChange: (state) => states.push(state),
  });
  return { fit, resize, release, states, setSize: (next: { cols: number; rows: number } | null) => (size = next) };
}

describe("createAutoFit", () => {
  it("fits the terminal to this window once attached", () => {
    const { fit, resize } = setup();
    fit.viewportChanged();
    expect(resize).not.toHaveBeenCalled();
    fit.attached();
    expect(resize).toHaveBeenCalledWith(120, 40);
  });

  it("follows the window but does not repeat the same size", () => {
    const { fit, resize, setSize } = setup();
    fit.attached();
    fit.viewportChanged();
    expect(resize).toHaveBeenCalledTimes(1);
    setSize({ cols: 100, rows: 30 });
    fit.viewportChanged();
    expect(resize).toHaveBeenLastCalledWith(100, 30);
    fit.owner("me");
    expect(fit.state()).toBe("fitting");
  });

  it("pauses when the host takes the size back", () => {
    const { fit, resize, states } = setup();
    fit.attached();
    fit.owner("desktop");
    expect(fit.state()).toBe("paused");
    expect(states).toEqual(["paused"]);
    // 호스트가 알려 온 크기를 다시 받아도, 멈춘 동안에는 아무것도 보내지 않는다.
    fit.owner("desktop");
    expect(resize).toHaveBeenCalledTimes(1);
  });

  it("fits again when the user resizes the window or asks", () => {
    const { fit, resize } = setup();
    fit.attached();
    fit.owner("desktop");
    fit.viewportChanged();
    expect(fit.state()).toBe("fitting");
    expect(resize).toHaveBeenCalledTimes(2);
    fit.owner("desktop");
    fit.refit();
    expect(fit.state()).toBe("fitting");
    expect(resize).toHaveBeenCalledTimes(3);
  });

  it("fits again after a reconnect", () => {
    const { fit, resize } = setup();
    fit.attached();
    fit.owner("desktop");
    fit.attached();
    expect(fit.state()).toBe("fitting");
    expect(resize).toHaveBeenCalledTimes(2);
  });

  it("leaves the size to the host while asked to", () => {
    const { fit, resize, release, setSize } = setup();
    fit.attached();
    fit.keepHost(true);
    expect(release).toHaveBeenCalledOnce();
    expect(fit.state()).toBe("host");
    setSize({ cols: 90, rows: 20 });
    fit.viewportChanged();
    fit.attached();
    fit.owner("desktop");
    expect(resize).toHaveBeenCalledTimes(1);
    expect(fit.state()).toBe("host");
    fit.keepHost(false);
    expect(resize).toHaveBeenLastCalledWith(90, 20);
    expect(fit.state()).toBe("fitting");
  });

  it("waits until the terminal can be measured", () => {
    const { fit, resize, setSize } = setup();
    setSize(null);
    fit.attached();
    setSize({ cols: 1, rows: 0 });
    fit.viewportChanged();
    expect(resize).not.toHaveBeenCalled();
  });
});
