// @vitest-environment node

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RemoteDeviceStore } from "./device-store";

async function store() {
  const dir = await mkdtemp(path.join(tmpdir(), "mcw-devices-"));
  const filePath = path.join(dir, "remote-devices.json");
  let id = 0;
  return {
    filePath,
    store: new RemoteDeviceStore(filePath, {
      now: () => "2026-09-30T00:00:00.000Z",
      randomId: () => `id-${++id}`,
    }),
  };
}

describe("RemoteDeviceStore", () => {
  it("creates a stable host id once", async () => {
    const { store: devices } = await store();
    const first = await devices.hostId();
    expect(first).toBe("id-1");
    expect(await devices.hostId()).toBe(first);
  });

  it("registers a device, stores only the token hash, and verifies the token", async () => {
    const { store: devices, filePath } = await store();
    const { device, token } = await devices.register("  내 폰  ");
    expect(device.name).toBe("내 폰");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const saved = await readFile(filePath, "utf8");
    expect(saved).not.toContain(token);
    expect((await devices.verify(token))?.deviceId).toBe(device.deviceId);
    expect(await devices.verify(`${token}x`)).toBeNull();
    expect(await devices.verify("")).toBeNull();
  });

  it("revokes a device so its token stops working", async () => {
    const { store: devices } = await store();
    const { device, token } = await devices.register("폰");
    expect(await devices.revoke(device.deviceId)).toBe(true);
    expect(await devices.verify(token)).toBeNull();
    expect(await devices.revoke(device.deviceId)).toBe(false);
    expect(await devices.list()).toEqual([]);
  });

  it("records the last time a device connected", async () => {
    const { store: devices } = await store();
    const { device } = await devices.register("폰");
    await devices.touch(device.deviceId);
    expect((await devices.list())[0]!.lastSeenAt).toBe("2026-09-30T00:00:00.000Z");
  });

  it("falls back to a default name and caps long names", async () => {
    const { store: devices } = await store();
    expect((await devices.register("   ")).device.name).toBe("이름 없는 기기");
    expect((await devices.register("가".repeat(100))).device.name).toHaveLength(40);
  });
});
