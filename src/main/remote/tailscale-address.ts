import type os from "node:os";

/** Tailscale이 기기에 나눠 주는 CGNAT 대역 100.64.0.0/10. */
export function isTailscaleAddress(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [first, second] = parts.map(Number);
  return first === 100 && second >= 64 && second <= 127;
}

/** Tailscale이 기기마다 주는 ULA 대역 fd7a:115c:a1e0::/48. */
function isTailscaleIpv6(address: string): boolean {
  return address.toLowerCase().startsWith("fd7a:115c:a1e0:");
}

const TAILSCALE_INTERFACE_NAME = /tailscale/i;

/**
 * 원격 서버가 bind해도 되는 주소들. 100.64.0.0/10은 통신사 CGNAT 대역이기도 해서(LTE 모뎀·테더링),
 * 주소만 보지 않고 인터페이스가 Tailscale인지도 본다: 이름이 Tailscale이거나, 같은 인터페이스에
 * Tailscale IPv6 주소가 함께 있어야 한다.
 */
export function tailscaleAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string[] {
  const found: string[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    const isTailscaleInterface =
      TAILSCALE_INTERFACE_NAME.test(name) ||
      (entries ?? []).some((entry) => entry.family === "IPv6" && isTailscaleIpv6(entry.address));
    if (!isTailscaleInterface) continue;
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4") continue;
      if (isTailscaleAddress(entry.address)) found.push(entry.address);
    }
  }
  return found;
}
