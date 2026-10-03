// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { RemoteHostInfo, RemoteHostLink } from "../../shared/remote-types";
import type { HostPairing } from "./host-registry";
import { createRemoteHostsService } from "./remote-hosts-service";

const INFO: RemoteHostInfo = {
  hostId: "host-1",
  name: "회사PC",
  address: "100.64.0.9:47821",
  notify: true,
  paired: true,
  addedAt: "2026-10-03T00:00:00.000Z",
};
const PAIRING: HostPairing = { hostId: "host-1", hostName: "회사PC", address: "100.64.0.9:47821", deviceId: "dev-1", token: "tok" };
const VIEW = { ...INFO, link: "open" as RemoteHostLink, awaiting: 2 };

function setup(overrides: { canStore?: boolean; pairFails?: boolean } = {}) {
  let hosts = [INFO];
  const registry = {
    canStore: vi.fn(() => overrides.canStore ?? true),
    list: vi.fn(async () => hosts),
    save: vi.fn(async () => INFO),
    remove: vi.fn(async () => undefined),
    clearToken: vi.fn(async () => undefined),
    setNotify: vi.fn(async (_hostId: string, notify: boolean) => {
      hosts = [{ ...INFO, notify }];
    }),
    pairings: vi.fn(async () => [PAIRING]),
  };
  const windows = { open: vi.fn(async () => undefined), closeHost: vi.fn() };
  const links = {
    sync: vi.fn(),
    snapshot: vi.fn(() => ({ link: "open" as RemoteHostLink, awaiting: 2 })),
  };
  const pair = vi.fn(async () => {
    if (overrides.pairFails) throw new Error("코드가 맞지 않거나 만료되었습니다");
    return { token: "tok", deviceId: "dev-1", hostId: "host-1", hostName: "회사PC" };
  });
  const announce = vi.fn();
  const service = createRemoteHostsService({
    registry,
    windows,
    links,
    pair,
    deviceName: "내 노트북",
    allowLoopback: false,
    announce,
  });
  return { service, registry, windows, links, pair, announce };
}

describe("remote hosts service", () => {
  it("lists hosts with their link state", async () => {
    const { service, links } = setup();
    expect(await service.list()).toEqual([VIEW]);
    expect(links.snapshot).toHaveBeenCalledWith("host-1");
  });

  it("links the paired hosts when it starts", async () => {
    const { service, links } = setup();
    await service.start();
    expect(links.sync).toHaveBeenCalledWith([PAIRING]);
  });

  it("pairs, saves, drops the stale window, re-links, and announces", async () => {
    const { service, registry, windows, links, pair, announce } = setup();
    expect(await service.add({ address: "100.64.0.9:47821", code: "ABCD-EFGH" })).toEqual(VIEW);
    expect(pair).toHaveBeenCalledWith({ address: "100.64.0.9:47821", code: "ABCD-EFGH", expectedHostId: null }, "내 노트북");
    expect(registry.save).toHaveBeenCalledWith({
      hostId: "host-1",
      name: "회사PC",
      address: "100.64.0.9:47821",
      deviceId: "dev-1",
      token: "tok",
    });
    expect(windows.closeHost).toHaveBeenCalledWith("host-1");
    expect(links.sync).toHaveBeenCalledWith([PAIRING]);
    expect(announce).toHaveBeenCalledWith([VIEW]);
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

  it("closes the window, re-links, and announces when a host is removed", async () => {
    const { service, registry, windows, links, announce } = setup();
    await service.remove("host-1");
    expect(windows.closeHost).toHaveBeenCalledWith("host-1");
    expect(registry.remove).toHaveBeenCalledWith("host-1");
    expect(links.sync).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledOnce();
  });

  it("re-links in the order the changes happened, so a slow earlier read cannot win", async () => {
    const { service, registry, links } = setup();
    let finishFirstRead: (hosts: HostPairing[]) => void = () => undefined;
    registry.pairings
      .mockImplementationOnce(() => new Promise<HostPairing[]>((resolve) => { finishFirstRead = resolve; }))
      .mockImplementationOnce(async () => []);
    const starting = service.start();
    const removing = service.remove("host-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    finishFirstRead([PAIRING]);
    await Promise.all([starting, removing]);
    // 앱이 뜨며 읽은 목록(호스트 있음)이 삭제 뒤의 목록(없음)을 덮어쓰면, 지운 호스트에 다시 붙는다.
    expect(links.sync.mock.calls.map((call) => call[0])).toEqual([[PAIRING], []]);
  });

  it("opens a host", async () => {
    const { service, windows } = setup();
    await service.open("host-1");
    expect(windows.open).toHaveBeenCalledWith("host-1");
  });

  it("drops the token of a host that rejected the link, and its window", async () => {
    const { service, registry, windows, links, announce } = setup();
    await service.unpaired("host-1");
    expect(registry.clearToken).toHaveBeenCalledWith("host-1");
    expect(windows.closeHost).toHaveBeenCalledWith("host-1");
    expect(links.sync).toHaveBeenCalledOnce();
    expect(announce).toHaveBeenCalledOnce();
  });

  it("turns a host's notifications on and off", async () => {
    const { service, registry, announce } = setup();
    // 한 번도 읽지 않았으면 모른다 — 모르는 호스트의 알림은 내지 않는다.
    expect(service.notifyEnabled("host-1")).toBe(false);
    await service.list();
    expect(service.notifyEnabled("host-1")).toBe(true);
    await service.setNotify("host-1", false);
    expect(registry.setNotify).toHaveBeenCalledWith("host-1", false);
    expect(service.notifyEnabled("host-1")).toBe(false);
    expect(announce).toHaveBeenLastCalledWith([{ ...VIEW, notify: false }]);
  });

  it("announces when a link's state changes", async () => {
    const { service, announce } = setup();
    await service.linkChanged();
    expect(announce).toHaveBeenCalledWith([VIEW]);
  });
});
