import { describe, expect, it } from "vitest";
import { createTerminalNotificationDeduper, shouldShowTerminalStatusNotification } from "./notification-policy";

describe("shouldShowTerminalStatusNotification", () => {
  it("notifies for a background session even while the app window is focused", () => {
    expect(
      shouldShowTerminalStatusNotification({
        eventSessionId: "background-session",
        selectedSessionId: "visible-session",
        visibleSessionIds: ["visible-session"],
        windowVisible: true,
        windowFocused: true,
      }),
    ).toBe(true);
  });

  it("suppresses a notification only while its session is actively visible", () => {
    expect(
      shouldShowTerminalStatusNotification({
        eventSessionId: "visible-session",
        selectedSessionId: "visible-session",
        visibleSessionIds: ["visible-session"],
        windowVisible: true,
        windowFocused: true,
      }),
    ).toBe(false);

    expect(
      shouldShowTerminalStatusNotification({
        eventSessionId: "visible-session",
        selectedSessionId: "visible-session",
        visibleSessionIds: ["visible-session"],
        windowVisible: false,
        windowFocused: false,
      }),
    ).toBe(true);

    expect(
      shouldShowTerminalStatusNotification({
        eventSessionId: "visible-session",
        selectedSessionId: "visible-session",
        visibleSessionIds: ["visible-session"],
        windowVisible: true,
        windowFocused: false,
      }),
    ).toBe(true);
  });

  it("treats every grid pane as on screen, exactly like the selected session", () => {
    expect(
      shouldShowTerminalStatusNotification({
        eventSessionId: "pane-session",
        selectedSessionId: "visible-session",
        visibleSessionIds: ["visible-session", "other-pane", "pane-session"],
        windowVisible: true,
        windowFocused: true,
      }),
    ).toBe(false);

    // An unfocused window still notifies, gridded or not.
    expect(
      shouldShowTerminalStatusNotification({
        eventSessionId: "pane-session",
        selectedSessionId: "visible-session",
        visibleSessionIds: ["visible-session", "pane-session"],
        windowVisible: true,
        windowFocused: false,
      }),
    ).toBe(true);
  });

  it("falls back to the selected session when the grid list omits it", () => {
    expect(
      shouldShowTerminalStatusNotification({
        eventSessionId: "visible-session",
        selectedSessionId: "visible-session",
        visibleSessionIds: [],
        windowVisible: true,
        windowFocused: true,
      }),
    ).toBe(false);
  });
});

describe("createTerminalNotificationDeduper", () => {
  it("suppresses a repeat of the last notified status until the session is seen", () => {
    const deduper = createTerminalNotificationDeduper();

    expect(deduper.shouldNotify("session-1", "awaiting-input")).toBe(true);
    expect(deduper.shouldNotify("session-1", "awaiting-input")).toBe(false);
  });

  it("notifies again when the session re-enters a wait state after a different notified status", () => {
    const deduper = createTerminalNotificationDeduper();

    expect(deduper.shouldNotify("session-1", "awaiting-input")).toBe(true);
    expect(deduper.shouldNotify("session-1", "awaiting-approval")).toBe(true);
    expect(deduper.shouldNotify("session-1", "awaiting-input")).toBe(true);
  });

  it("notifies again after the session has been seen or interacted with", () => {
    const deduper = createTerminalNotificationDeduper();

    expect(deduper.shouldNotify("session-1", "awaiting-input")).toBe(true);
    deduper.reset("session-1");
    expect(deduper.shouldNotify("session-1", "awaiting-input")).toBe(true);
  });

  it("tracks sessions independently", () => {
    const deduper = createTerminalNotificationDeduper();

    expect(deduper.shouldNotify("session-1", "awaiting-input")).toBe(true);
    expect(deduper.shouldNotify("session-2", "awaiting-input")).toBe(true);
    expect(deduper.shouldNotify("session-1", "awaiting-input")).toBe(false);
    deduper.reset("session-2");
    expect(deduper.shouldNotify("session-1", "awaiting-input")).toBe(false);
  });
});
