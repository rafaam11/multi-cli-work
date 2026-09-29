import { describe, expect, it, vi } from "vitest";
import { readShellBridge } from "./shell-bridge";

function raw(overrides: Record<string, unknown> = {}) {
  return {
    bridgeVersion: () => 1,
    pairingJson: () => JSON.stringify({ token: "t", deviceId: "d", hostName: "PC" }),
    unpaired: vi.fn(),
    backToHosts: vi.fn(),
    ...overrides,
  };
}

describe("readShellBridge", () => {
  it("is null in a plain browser", () => {
    expect(readShellBridge({})).toBeNull();
  });

  it("reads the pairing the shell hands over and forwards the calls", () => {
    const shell = raw();
    const bridge = readShellBridge({ McwShell: shell })!;
    expect(bridge.bridgeVersion).toBe(1);
    expect(bridge.pairing).toEqual({ token: "t", deviceId: "d", hostName: "PC" });
    bridge.unpaired();
    bridge.backToHosts();
    expect(shell.unpaired).toHaveBeenCalled();
    expect(shell.backToHosts).toHaveBeenCalled();
  });

  it("treats a broken pairing payload as no pairing, not a crash", () => {
    expect(readShellBridge({ McwShell: raw({ pairingJson: () => "{bad" }) })!.pairing).toBeNull();
    expect(readShellBridge({ McwShell: raw({ pairingJson: () => '{"token":1}' }) })!.pairing).toBeNull();
  });

  it("ignores an object that is not the shell", () => {
    expect(readShellBridge({ McwShell: { hello: 1 } })).toBeNull();
  });
});
