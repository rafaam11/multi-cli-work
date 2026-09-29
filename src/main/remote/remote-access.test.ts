// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { pairingUri, RemoteAccess, type RemoteAccessOptions } from "./remote-access";

function setup(overrides: Partial<RemoteAccessOptions> = {}) {
  let addresses = ["100.101.102.103"];
  const close = vi.fn(async () => undefined);
  const start = vi.fn(async (options: { host: string; port: number }) => ({ host: options.host, port: options.port, close }));
  const devices = {
    hostId: vi.fn(async () => "host-1"),
    list: vi.fn(async () => [{ deviceId: "d1", name: "폰", tokenHash: "x".repeat(64), createdAt: "c", lastSeenAt: null }]),
    register: vi.fn(async () => ({
      device: { deviceId: "d2", name: "폰", tokenHash: "", createdAt: "", lastSeenAt: null },
      token: "tok",
    })),
    revoke: vi.fn(async () => true),
  };
  const pairing = { issue: vi.fn(() => ({ code: "ABCD-EFGH", expiresAt: 1_000 })), consume: vi.fn(() => "ok" as const) };
  const hub = { open: vi.fn(), disconnectDevice: vi.fn(), dispose: vi.fn() };
  const access = new RemoteAccess({
    hub,
    devices,
    pairing,
    rendererDir: "out/renderer",
    hostName: "PC",
    bindOverride: null,
    addresses: () => addresses,
    start: start as never,
    retryMs: 20,
    ...overrides,
  });
  return { access, start, close, devices, pairing, hub, setAddresses: (next: string[]) => (addresses = next) };
}

afterEach(() => vi.useRealTimers());

describe("RemoteAccess", () => {
  it("hands the bundled shell to the server", async () => {
    const shell = { release: { versionCode: 1, versionName: "0.1.0", sha256: "a".repeat(64) }, apkPath: "x" };
    const { access, start } = setup({ shell });
    await access.apply({ enabled: true, port: 47821 });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ shell }));
  });

  it("stays off by default and listens on the Tailscale address when enabled", async () => {
    const { access, start } = setup();
    expect((await access.apply({ enabled: false, port: 47821 })).state).toBe("off");
    expect(start).not.toHaveBeenCalled();
    const status = await access.apply({ enabled: true, port: 47821 });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ host: "100.101.102.103", port: 47821 }));
    expect(status).toEqual({ state: "listening", url: "http://100.101.102.103:47821/mobile/", port: 47821, message: null });
  });

  it("does not restart for an unchanged setting, restarts on a port change, and stops when disabled", async () => {
    const { access, start, close } = setup();
    await access.apply({ enabled: true, port: 47821 });
    await access.apply({ enabled: true, port: 47821 });
    expect(start).toHaveBeenCalledTimes(1);
    await access.apply({ enabled: true, port: 50000 });
    expect(close).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(2);
    await access.apply({ enabled: false, port: 50000 });
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("reports no-tailscale and never binds anything else", async () => {
    const { access, start, setAddresses } = setup();
    setAddresses([]);
    const status = await access.apply({ enabled: true, port: 47821 });
    expect(status.state).toBe("no-tailscale");
    expect(status.message).toContain("Tailscale");
    expect(start).not.toHaveBeenCalled();
    await access.dispose(); // 재시도 타이머를 멈춘다
  });

  it("retries when Tailscale appears later", async () => {
    const { access, start, setAddresses } = setup();
    setAddresses([]);
    await access.apply({ enabled: true, port: 47821 });
    setAddresses(["100.64.0.9"]);
    await vi.waitFor(() => expect(access.status().state).toBe("listening"), { timeout: 500 });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ host: "100.64.0.9" }));
    await access.dispose();
  });

  it("uses the env bind override instead of Tailscale", async () => {
    const { access, start } = setup({ bindOverride: "127.0.0.1", addresses: () => [] });
    await access.apply({ enabled: true, port: 47821 });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ host: "127.0.0.1" }));
  });

  it("reports a listen failure as an error state", async () => {
    const { access } = setup({ start: (async () => { throw new Error("listen EADDRINUSE"); }) as never });
    const status = await access.apply({ enabled: true, port: 47821 });
    expect(status).toMatchObject({ state: "error", message: expect.stringContaining("EADDRINUSE") });
  });

  it("issues a pairing code with a QR URI and install URL only while listening", async () => {
    const { access } = setup();
    await expect(access.issuePairingCode()).rejects.toThrow(/켜져/);
    await access.apply({ enabled: true, port: 47821 });
    expect(await access.issuePairingCode()).toEqual({
      code: "ABCD-EFGH",
      expiresAt: new Date(1_000).toISOString(),
      url: "http://100.101.102.103:47821/mobile/",
      pairUri: "mcw://pair?host=100.101.102.103:47821&name=PC&code=ABCDEFGH&fp=host-1",
      installUrl: "http://100.101.102.103:47821/install",
    });
  });

  it("encodes the host name in the pairing URI", () => {
    expect(pairingUri({ address: "100.64.0.1:47821", hostName: "내 PC & 노트북", code: "ABCD-EFGH", hostId: "h" })).toBe(
      "mcw://pair?host=100.64.0.1:47821&name=%EB%82%B4%20PC%20%26%20%EB%85%B8%ED%8A%B8%EB%B6%81&code=ABCDEFGH&fp=h",
    );
  });

  it("pairs a device through the one-shot code", async () => {
    const { access, devices } = setup();
    await expect(access.pair("ABCD-EFGH", "폰", "100.1.1.1")).resolves.toEqual({
      ok: true,
      response: { token: "tok", deviceId: "d2", hostId: "host-1", hostName: "PC" },
    });
    expect(devices.register).toHaveBeenCalledWith("폰");
  });

  it("lists devices without hashes and disconnects a revoked one", async () => {
    const { access, hub } = setup();
    expect(await access.listDevices()).toEqual([{ deviceId: "d1", name: "폰", createdAt: "c", lastSeenAt: null }]);
    await access.revokeDevice("d1");
    expect(hub.disconnectDevice).toHaveBeenCalledWith("d1");
  });
});
