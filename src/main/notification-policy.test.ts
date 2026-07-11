import { describe, expect, it } from "vitest";
import { shouldShowTerminalStatusNotification } from "./notification-policy";

describe("shouldShowTerminalStatusNotification", () => {
  it("notifies for a background session even while the app window is focused", () => {
    expect(
      shouldShowTerminalStatusNotification({
        eventSessionId: "background-session",
        selectedSessionId: "visible-session",
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
        windowVisible: true,
        windowFocused: true,
      }),
    ).toBe(false);

    expect(
      shouldShowTerminalStatusNotification({
        eventSessionId: "visible-session",
        selectedSessionId: "visible-session",
        windowVisible: false,
        windowFocused: false,
      }),
    ).toBe(true);

    expect(
      shouldShowTerminalStatusNotification({
        eventSessionId: "visible-session",
        selectedSessionId: "visible-session",
        windowVisible: true,
        windowFocused: false,
      }),
    ).toBe(true);
  });
});
