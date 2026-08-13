// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../shared/settings-types";
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

describe("notification settings gate", () => {
  function buildController(overrides: Partial<Parameters<typeof createSessionAttentionController>[0]> = {}) {
    const notify = vi.fn();
    const publish = vi.fn();
    const controller = createSessionAttentionController({
      readSelection: async () => ({ selectedSessionId: null, visibleSessionIds: [] }),
      windowState: () => ({ visible: false, focused: false }),
      publish,
      notify,
      navigate: vi.fn(),
      ...overrides,
    });
    return { controller, notify, publish };
  }

  const allOn = {
    desktop: true,
    statuses: { "awaiting-input": true, "awaiting-approval": true, exited: true, error: true },
  } as const;

  it("마스터 토글이 꺼지면 알림은 없지만 배지 상태는 그대로 발행된다", async () => {
    const { controller, notify, publish } = buildController({
      notificationSettings: () => ({ ...DEFAULT_SETTINGS.notifications, desktop: false }),
    });
    await controller.handleStatus("session-1", "awaiting-input");
    expect(notify).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalled();
  });

  it("상태별 토글이 꺼진 상태만 조용하다", async () => {
    const { controller, notify } = buildController({
      notificationSettings: () => ({
        desktop: true,
        statuses: { "awaiting-input": false, "awaiting-approval": true, exited: false, error: false },
      }),
    });
    await controller.handleStatus("session-1", "awaiting-input");
    expect(notify).not.toHaveBeenCalled();
    await controller.handleStatus("session-1", "awaiting-approval");
    expect(notify).toHaveBeenCalledWith("session-1", "awaiting-approval", expect.any(Function));
  });

  it("exited·error는 기본값에서 알리지 않는다 — 옵션이 없어도 같다", async () => {
    const explicit = buildController({ notificationSettings: () => DEFAULT_SETTINGS.notifications });
    await explicit.controller.handleStatus("session-1", "exited");
    await explicit.controller.handleStatus("session-1", "error");
    expect(explicit.notify).not.toHaveBeenCalled();

    const legacy = buildController(); // notificationSettings 미지정 = 오늘의 앱
    await legacy.controller.handleStatus("session-1", "exited");
    expect(legacy.notify).not.toHaveBeenCalled();
  });

  it("켜면 exited·error도 알리되, 창이 보이며 포커스를 쥔 동안은 알리지 않는다", async () => {
    const hidden = buildController({ notificationSettings: () => allOn });
    await hidden.controller.handleStatus("session-1", "exited");
    expect(hidden.notify).toHaveBeenCalledWith("session-1", "exited", expect.any(Function));

    const focused = buildController({
      notificationSettings: () => allOn,
      windowState: () => ({ visible: true, focused: true }),
      readSelection: async () => ({ selectedSessionId: "session-1", visibleSessionIds: ["session-1"] }),
    });
    await focused.controller.handleStatus("session-1", "error");
    expect(focused.notify).not.toHaveBeenCalled();
  });
});
