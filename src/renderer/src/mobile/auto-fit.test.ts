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
    fit.areaChanged();
    fit.windowResized();
    expect(resize).not.toHaveBeenCalled();
    fit.attached();
    expect(resize).toHaveBeenCalledWith(120, 40);
  });

  it("follows the terminal area but does not repeat the same size", () => {
    const { fit, resize, setSize } = setup();
    fit.attached();
    fit.areaChanged();
    fit.windowResized();
    expect(resize).toHaveBeenCalledTimes(1);
    setSize({ cols: 100, rows: 30 });
    fit.areaChanged();
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

  it("stays paused when the terminal area changes on its own", () => {
    const { fit, resize, setSize } = setup();
    fit.attached();
    fit.owner("desktop");
    // 호스트 크기로 그려진 터미널이 이 창을 넘치면 스크롤바가 생기고, 그만큼 들어가는 열·행 수가
    // 달라진다. 사용자가 창을 건드린 것이 아니므로 크기를 도로 가져가면 안 된다.
    setSize({ cols: 121, rows: 39 });
    fit.areaChanged();
    fit.areaChanged();
    expect(fit.state()).toBe("paused");
    expect(resize).toHaveBeenCalledTimes(1);
  });

  it("fits again when the user resizes the window or asks", () => {
    const { fit, resize } = setup();
    fit.attached();
    fit.owner("desktop");
    fit.windowResized();
    expect(fit.state()).toBe("fitting");
    expect(resize).toHaveBeenCalledTimes(2);
    fit.owner("desktop");
    fit.refit();
    expect(fit.state()).toBe("fitting");
    expect(resize).toHaveBeenCalledTimes(3);
  });

  it("stays paused across a reconnect", () => {
    const { fit, resize } = setup();
    fit.attached();
    fit.owner("desktop");
    fit.attached();
    fit.areaChanged();
    expect(fit.state()).toBe("paused");
    expect(resize).toHaveBeenCalledTimes(1);
  });

  it("leaves the size to the host while asked to", () => {
    const { fit, resize, release, setSize } = setup();
    fit.attached();
    fit.keepHost(true);
    expect(release).toHaveBeenCalledOnce();
    expect(fit.state()).toBe("host");
    setSize({ cols: 90, rows: 20 });
    fit.areaChanged();
    fit.windowResized();
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
    fit.areaChanged();
    fit.windowResized();
    expect(resize).not.toHaveBeenCalled();
  });
});
