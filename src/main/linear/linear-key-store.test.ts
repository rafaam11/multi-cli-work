import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLinearKeyStore } from "./linear-key-store";
import type { SafeStorageLike } from "../storage/encrypted-token-store";

async function tempCredentialsPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "linear-credentials-"));
  return path.join(dir, "linear-credentials.json");
}

/** 실제 safeStorage 대신 쓰는 되돌릴 수 있는 변환 — 평문이 파일에 남지 않는지 보기 위한 것이다. */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) => Buffer.from(`enc:${plainText}`, "utf8").reverse(),
    decryptString: (encrypted) => {
      const text = Buffer.from(encrypted).reverse().toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("cannot decrypt");
      return text.slice(4);
    },
  };
}

describe("Linear 키 보관소", () => {
  it("저장한 키를 그대로 읽고, 파일에는 원문이 없다", async () => {
    const filePath = await tempCredentialsPath();
    const store = createLinearKeyStore(filePath, fakeSafeStorage());
    await store.write("lin_api_secret");
    await expect(store.read()).resolves.toBe("lin_api_secret");
    expect(await readFile(filePath, "utf8")).not.toContain("lin_api_secret");
  });

  it("지우면 키가 없다", async () => {
    const store = createLinearKeyStore(await tempCredentialsPath(), fakeSafeStorage());
    await store.write("lin_api_secret");
    await store.clear();
    await expect(store.read()).resolves.toBeNull();
  });

  it("암호화를 쓸 수 없으면 저장하지 않는다", async () => {
    const store = createLinearKeyStore(await tempCredentialsPath(), fakeSafeStorage(false));
    expect(store.encryptionAvailable()).toBe(false);
    await expect(store.write("lin_api_secret")).rejects.toThrow();
  });
});
