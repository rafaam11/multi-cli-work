// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { RemoteHostInfo } from "../../shared/remote-types";
import { createRemoteHostsService } from "./remote-hosts-service";

const INFO: RemoteHostInfo = {
  hostId: "host-1",
  name: "회사PC",
  address: "100.64.0.9:47821",
  notify: true,
  paired: true,
  addedAt: "2026-10-03T00:00:00.000Z",
};

function setup(overrides: { canStore?: boolean; pairFails?: boolean } = {}) {
  const registry = {
    canStore: vi.fn(() => overrides.canStore ?? true),
    list: vi.fn(async () => [INFO]),
    save: vi.fn(async () => INFO),
    remove: vi.fn(async () => undefined),
    clearToken: vi.fn(async () => undefined),
  };
  const windows = { open: vi.fn(async () => undefined), closeHost: vi.fn() };
  const pair = vi.fn(async () => {
    if (overrides.pairFails) throw new Error("코드가 맞지 않거나 만료되었습니다");
    return { token: "tok", deviceId: "dev-1", hostId: "host-1", hostName: "회사PC" };
  });
  const announce = vi.fn();
  const service = createRemoteHostsService({
    registry,
    windows,
    pair,
    deviceName: "내 노트북",
    allowLoopback: false,
    announce,
  });
  return { service, registry, windows, pair, announce };
}

describe("remote hosts service", () => {
  it("pairs, saves, drops the stale window, and announces", async () => {
    const { service, registry, windows, pair, announce } = setup();
    expect(await service.add({ address: "100.64.0.9:47821", code: "ABCD-EFGH" })).toEqual(INFO);
    expect(pair).toHaveBeenCalledWith({ address: "100.64.0.9:47821", code: "ABCD-EFGH", expectedHostId: null }, "내 노트북");
    expect(registry.save).toHaveBeenCalledWith({
      hostId: "host-1",
      name: "회사PC",
      address: "100.64.0.9:47821",
      deviceId: "dev-1",
      token: "tok",
    });
    expect(windows.closeHost).toHaveBeenCalledWith("host-1");
    expect(announce).toHaveBeenCalledWith([INFO]);
  });

  it("does not pair or save when the address is wrong", async () => {
    const { service, registry, pair, announce } = setup();
    await expect(service.add({ address: "192.168.0.5:47821", code: "ABCD-EFGH" })).rejects.toThrow("Tailscale 주소");
    expect(pair).not.toHaveBeenCalled();
    expect(registry.save).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it("saves nothing when the host refuses the code", async () => {
    const { service, registry, announce } = setup({ pairFails: true });
    await expect(service.add({ address: "100.64.0.9:47821", code: "WRONG" })).rejects.toThrow("코드가 맞지 않거나");
    expect(registry.save).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it("does not register a device on the host when the token could not be stored", async () => {
    const { service, pair } = setup({ canStore: false });
    await expect(service.add({ address: "100.64.0.9:47821", code: "ABCD-EFGH" })).rejects.toThrow("안전하게 저장할 수 없습니다");
    expect(pair).not.toHaveBeenCalled();
  });

  it("closes the window before removing a host", async () => {
    const { service, registry, windows, announce } = setup();
    await service.remove("host-1");
    expect(windows.closeHost).toHaveBeenCalledWith("host-1");
    expect(registry.remove).toHaveBeenCalledWith("host-1");
    expect(announce).toHaveBeenCalledOnce();
  });

  it("opens a host and marks a rejected one", async () => {
    const { service, registry, windows, announce } = setup();
    await service.open("host-1");
    expect(windows.open).toHaveBeenCalledWith("host-1");
    await service.unpaired("host-1");
    expect(registry.clearToken).toHaveBeenCalledWith("host-1");
    expect(announce).toHaveBeenCalledOnce();
  });
});
