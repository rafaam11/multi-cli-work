// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { TerminalSizeArbiter } from "./size-arbiter";
import { watchSizeOwners } from "./size-owner-events";

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("watchSizeOwners", () => {
  it("tells the desktop only when a session's size changes hands", async () => {
    const sizes = new TerminalSizeArbiter(async () => undefined);
    const send = vi.fn();
    watchSizeOwners({ sizes, deviceName: async (deviceId) => (deviceId === "phone" ? "내 폰" : null), send });

    await sizes.desktopResize("s", 120, 40);
    await sizes.deviceResize("phone", "s", 45, 30);
    await sizes.deviceResize("phone", "s", 50, 30);
    await flush();
    expect(send.mock.calls).toEqual([[{ sessionId: "s", deviceName: "내 폰" }]]);

    await sizes.desktopInput("s");
    await sizes.desktopResize("s", 100, 40);
    await flush();
    expect(send.mock.calls.at(-1)).toEqual([{ sessionId: "s", deviceName: null }]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("names a device it cannot find generically", async () => {
    const sizes = new TerminalSizeArbiter(async () => undefined);
    const send = vi.fn();
    watchSizeOwners({ sizes, deviceName: async () => null, send });
    await sizes.deviceResize("gone", "s", 45, 30);
    await flush();
    expect(send).toHaveBeenCalledWith({ sessionId: "s", deviceName: "다른 기기" });
  });
});
