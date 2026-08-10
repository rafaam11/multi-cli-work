// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createSessionAttentionController } from "./session-attention-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe("createSessionAttentionController", () => {
  it("drops an awaiting result when a newer status wins while selection is loading", async () => {
    const selection = deferred<{ selectedSessionId: string | null; visibleSessionIds: string[] }>();
    const publish = vi.fn();
    const notify = vi.fn();
    const controller = createSessionAttentionController({
      readSelection: () => selection.promise,
      windowState: () => ({ visible: false, focused: false }),
      publish,
      notify,
      navigate: vi.fn(),
    });

    const stale = controller.handleStatus("session-1", "awaiting-input");
    await controller.handleStatus("session-1", "working");
    selection.resolve({ selectedSessionId: null, visibleSessionIds: [] });
    await stale;

    expect(controller.snapshot().unread).toEqual({});
    expect(notify).not.toHaveBeenCalled();
    expect(publish).toHaveBeenLastCalledWith({ window: "none", unread: {} });
  });

  it("navigates to the originating session and marks only that session seen on click", async () => {
    const publish = vi.fn();
    const navigate = vi.fn();
    const clicks = new Map<string, () => void>();
    const controller = createSessionAttentionController({
      readSelection: async () => ({ selectedSessionId: "session-visible", visibleSessionIds: ["session-visible"] }),
      windowState: () => ({ visible: false, focused: false }),
      publish,
      notify: (sessionId, _status, onClick) => { clicks.set(sessionId, onClick); },
      navigate,
    });
    await controller.handleStatus("session-other", "awaiting-approval");
    await controller.handleStatus("session-third", "awaiting-input");

    clicks.get("session-other")?.();

    expect(navigate).toHaveBeenCalledWith("session-other");
    expect(controller.snapshot().unread).toEqual({ "session-third": "input" });
  });

  it("marks only the on-screen grid sessions seen when the window is restored", async () => {
    const controller = createSessionAttentionController({
      readSelection: async () => ({ selectedSessionId: "primary", visibleSessionIds: ["primary", "pane-2"] }),
      windowState: () => ({ visible: false, focused: false }),
      publish: vi.fn(),
      notify: vi.fn(),
      navigate: vi.fn(),
    });
    await controller.handleStatus("primary", "awaiting-input");
    await controller.handleStatus("pane-2", "awaiting-approval");
    await controller.handleStatus("hidden", "awaiting-input");

    await controller.markVisibleSessionsSeen();

    expect(controller.snapshot().unread).toEqual({ hidden: "input" });
  });
});
