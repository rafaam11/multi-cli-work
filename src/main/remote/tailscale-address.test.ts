// @vitest-environment node

import type os from "node:os";
import { describe, expect, it } from "vitest";
import { isTailscaleAddress, tailscaleAddresses } from "./tailscale-address";

const entry = (address: string, family: "IPv4" | "IPv6" = "IPv4", internal = false): os.NetworkInterfaceInfo =>
  ({ address, family, internal, netmask: "", mac: "", cidr: null }) as os.NetworkInterfaceInfo;

describe("isTailscaleAddress", () => {
  it("accepts only 100.64.0.0/10", () => {
    expect(isTailscaleAddress("100.64.0.1")).toBe(true);
    expect(isTailscaleAddress("100.127.255.254")).toBe(true);
    expect(isTailscaleAddress("100.63.255.255")).toBe(false);
    expect(isTailscaleAddress("100.128.0.1")).toBe(false);
    expect(isTailscaleAddress("192.168.0.10")).toBe(false);
    expect(isTailscaleAddress("not-an-ip")).toBe(false);
  });
});

describe("tailscaleAddresses", () => {
  it("returns non-internal IPv4 tailnet addresses from any interface", () => {
    expect(
      tailscaleAddresses({
        Ethernet: [entry("192.168.0.10"), entry("fe80::1", "IPv6")],
        Tailscale: [entry("100.101.102.103"), entry("fd7a:115c:a1e0::1", "IPv6")],
        lo: [entry("127.0.0.1", "IPv4", true)],
      }),
    ).toEqual(["100.101.102.103"]);
  });

  it("returns an empty list when Tailscale is down", () => {
    expect(tailscaleAddresses({ Ethernet: [entry("10.0.0.2")] })).toEqual([]);
  });

  it("ignores carrier-grade NAT addresses on interfaces that are not Tailscale", () => {
    expect(
      tailscaleAddresses({
        "Cellular Modem": [entry("100.72.1.5")],
        Tailscale: [entry("100.101.102.103"), entry("fd7a:115c:a1e0::1", "IPv6")],
      }),
    ).toEqual(["100.101.102.103"]);
    expect(tailscaleAddresses({ "Cellular Modem": [entry("100.72.1.5")] })).toEqual([]);
  });

  it("recognises the Tailscale adapter by name even without its IPv6 address", () => {
    expect(tailscaleAddresses({ tailscale0: [entry("100.64.0.9")] })).toEqual(["100.64.0.9"]);
  });
});
