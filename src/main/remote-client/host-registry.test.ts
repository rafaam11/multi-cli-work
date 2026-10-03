// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SafeStorageLike } from "../notion/notion-token-store";
import { RemoteHostRegistry } from "./host-registry";

/** 실제 safeStorage 대신 쓰는 되돌릴 수 있는 변환 — 평문이 파일에 남지 않는지 보기 위한 것이다. */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`sealed:${[...text].reverse().join("")}`, "utf8"),
    decryptString: (buffer) => {
      const text = buffer.toString("utf8");
      if (!text.startsWith("sealed:")) throw new Error("not sealed by this account");
      return [...text.slice("sealed:".length)].reverse().join("");
    },
  };
}

const HOST = { hostId: "host-1", name: "회사PC", address: "100.64.0.9:47821", deviceId: "dev-1", token: "tok-secret" };

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-remote-hosts-"));
  filePath = path.join(dir, "remote-hosts.json");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("RemoteHostRegistry", () => {
  it("stores the token encrypted and never lists it", async () => {
    const registry = new RemoteHostRegistry(filePath, fakeSafeStorage(), () => "2026-10-03T00:00:00.000Z");
    const info = await registry.save(HOST);
    expect(info).toEqual({
      hostId: "host-1",
      name: "회사PC",
      address: "100.64.0.9:47821",
      notify: true,
      paired: true,
      addedAt: "2026-10-03T00:00:00.000Z",
    });
    expect(await registry.list()).toEqual([info]);
    expect(await fs.readFile(filePath, "utf8")).not.toContain("tok-secret");
    expect(await registry.pairing("host-1")).toEqual({
      hostId: "host-1",
      hostName: "회사PC",
      address: "100.64.0.9:47821",
      deviceId: "dev-1",
      token: "tok-secret",
    });
  });

  it("refuses to save when the token cannot be encrypted", async () => {
    const registry = new RemoteHostRegistry(filePath, fakeSafeStorage(false));
    expect(registry.canStore()).toBe(false);
    await expect(registry.save(HOST)).rejects.toThrow("안전하게 저장할 수 없습니다");
    expect(await registry.list()).toEqual([]);
  });

  it("replaces a host that is added again, keeping its place and settings", async () => {
    let now = "2026-10-03T00:00:00.000Z";
    const registry = new RemoteHostRegistry(filePath, fakeSafeStorage(), () => now);
    await registry.save(HOST);
    await registry.save({ ...HOST, hostId: "host-2", name: "집PC" });
    await registry.setNotify("host-1", false);
    now = "2026-10-04T00:00:00.000Z";
    await registry.save({ ...HOST, address: "100.64.0.9:50000", deviceId: "dev-2", token: "tok-new" });

    const hosts = await registry.list();
    expect(hosts.map((host) => host.hostId)).toEqual(["host-1", "host-2"]);
    expect(hosts[0]).toMatchObject({ address: "100.64.0.9:50000", notify: false, addedAt: "2026-10-03T00:00:00.000Z" });
    expect((await registry.pairing("host-1"))?.token).toBe("tok-new");
  });

  it("keeps a rejected host but drops its token", async () => {
    const registry = new RemoteHostRegistry(filePath, fakeSafeStorage());
    await registry.save(HOST);
    await registry.clearToken("host-1");
    expect(await registry.list()).toMatchObject([{ hostId: "host-1", paired: false }]);
    expect(await registry.pairing("host-1")).toBeNull();
  });

  it("removes a host", async () => {
    const registry = new RemoteHostRegistry(filePath, fakeSafeStorage());
    await registry.save(HOST);
    await registry.remove("host-1");
    expect(await registry.list()).toEqual([]);
    expect(await registry.pairing("host-1")).toBeNull();
  });

  it("treats a token sealed by another account as no pairing", async () => {
    const registry = new RemoteHostRegistry(filePath, fakeSafeStorage());
    await fs.writeFile(
      filePath,
      JSON.stringify({
        version: 1,
        hosts: [
          { hostId: "host-1", name: "회사PC", address: "100.64.0.9:47821", deviceId: "d", token: Buffer.from("other").toString("base64"), notify: true, addedAt: "x" },
          { hostId: 7, name: "깨진 항목" },
        ],
      }),
      "utf8",
    );
    expect(await registry.list()).toHaveLength(1);
    expect(await registry.pairing("host-1")).toBeNull();
  });
});
