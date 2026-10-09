import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePaneZoom } from "./use-pane-zoom";

describe("usePaneZoom", () => {
  const render = (initial: { visible: string[]; focused: string | null; resetKey: string }) =>
    renderHook((props) => usePaneZoom(props.visible, props.focused, props.resetKey), { initialProps: initial });

  it("toggles a pane in and out of zoom", () => {
    const hook = render({ visible: ["a", "b"], focused: "a", resetKey: "k" });
    act(() => hook.result.current.toggleZoom("a"));
    expect(hook.result.current.zoomedPaneId).toBe("a");
    act(() => hook.result.current.toggleZoom("a"));
    expect(hook.result.current.zoomedPaneId).toBeNull();
  });

  it("follows the focus to another pane on the page while zoomed", () => {
    const hook = render({ visible: ["a", "b"], focused: "a", resetKey: "k" });
    act(() => hook.result.current.toggleZoom("a"));
    hook.rerender({ visible: ["a", "b"], focused: "b", resetKey: "k" });
    expect(hook.result.current.zoomedPaneId).toBe("b");
  });

  it("lets go when the zoomed pane leaves the page or the arrangement changes", () => {
    const hook = render({ visible: ["a", "b"], focused: "a", resetKey: "k" });
    act(() => hook.result.current.toggleZoom("a"));
    hook.rerender({ visible: ["b"], focused: "a", resetKey: "k" });
    expect(hook.result.current.zoomedPaneId).toBeNull();

    hook.rerender({ visible: ["a", "b"], focused: "a", resetKey: "k" });
    act(() => hook.result.current.toggleZoom("a"));
    hook.rerender({ visible: ["a", "b"], focused: "a", resetKey: "other-layout" });
    expect(hook.result.current.zoomedPaneId).toBeNull();
  });

  it("clears on request", () => {
    const hook = render({ visible: ["a"], focused: "a", resetKey: "k" });
    act(() => hook.result.current.toggleZoom("a"));
    act(() => hook.result.current.clearZoom());
    expect(hook.result.current.zoomedPaneId).toBeNull();
  });
});
