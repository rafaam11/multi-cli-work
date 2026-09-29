import type os from "node:os";

/** Tailscale이 기기에 나눠 주는 CGNAT 대역 100.64.0.0/10. */
export function isTailscaleAddress(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [first, second] = parts.map(Number);
  return first === 100 && second >= 64 && second <= 127;
}

/** 원격 서버가 bind해도 되는 주소들. 다른 LAN·공인 주소는 절대 고르지 않는다. */
export function tailscaleAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string[] {
  const found: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4") continue;
      if (isTailscaleAddress(entry.address)) found.push(entry.address);
    }
  }
  return found;
}
