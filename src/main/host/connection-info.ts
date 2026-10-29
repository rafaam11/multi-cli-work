import path from "node:path";
import { readHostDescriptor } from "./host-process";
import { HostClient } from "./host-client";
import type { HostDescriptor } from "./gateway";

/** Private SSH stdout handshake. Never launches a host or repairs a stale descriptor. */
export async function readConnectionInfo(directory: string, expectedHostId: string): Promise<HostDescriptor> {
  if (!path.isAbsolute(directory) || !/^[\w-]{1,128}$/.test(expectedHostId)) throw new Error("Absolute host data root and expected identity required");
  const descriptor = await readHostDescriptor(directory);
  if (!descriptor) throw new Error("MCW host is not running");
  if (descriptor.hostId !== expectedHostId) throw new Error("MCW host identity differs");
  const client = new HostClient(descriptor), url = new URL(client.connection.url);
  if (!["127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("SSH handshake requires a loopback host");
  const health = await client.health();
  if (health.schemaVersion !== 2 || health.hostId !== expectedHostId) throw new Error("MCW host identity differs");
  return { schemaVersion: 2, pid: descriptor.pid, hostId: descriptor.hostId, instanceId: descriptor.instanceId,
    url: descriptor.url, token: descriptor.token, startedAt: descriptor.startedAt };
}
