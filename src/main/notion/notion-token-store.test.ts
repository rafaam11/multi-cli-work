import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createNotionTokenStore, type SafeStorageLike } from "./notion-token-store";

async function tempCredentialsPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "notion-credentials-"));
  return path.join(dir, "notion-credentials.json");
}

/** 실제 safeStorage 대신 쓰는 되돌릴 수 있는 변환 — 평문이 파일에 남지 않는지 보기 위한 것이다. */
function fakeSafeStorage(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText) => Buffer.from(`enc:${plainText}`, "utf8"),
    decryptString: (encrypted) => {
      const text = encrypted.toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("cannot decrypt");
      return text.slice(4);
    },
  };
}

describe("노션 토큰 보관소", () => {
  it("파일이 없으면 토큰도 없다", async () => {
    const store = createNotionTokenStore(await tempCredentialsPath(), fakeSafeStorage());
    await expect(store.read()).resolves.toBeNull();
  });

  it("저장한 토큰을 되읽고, 파일에는 평문을 남기지 않는다", async () => {
    const filePath = await tempCredentialsPath();
    const store = createNotionTokenStore(filePath, fakeSafeStorage());
    await store.write("ntn_supersecret");
    await expect(store.read()).resolves.toBe("ntn_supersecret");
    expect(await readFile(filePath, "utf8")).not.toContain("ntn_supersecret");
  });

  it("지우면 다시 없는 상태가 된다", async () => {
    const store = createNotionTokenStore(await tempCredentialsPath(), fakeSafeStorage());
    await store.write("ntn_supersecret");
    await store.clear();
    await expect(store.read()).resolves.toBeNull();
  });

  it("안전한 저장이 불가능하면 평문으로 떨어지지 않고 거절한다", async () => {
    const filePath = await tempCredentialsPath();
    const store = createNotionTokenStore(filePath, fakeSafeStorage(false));
    await expect(store.write("ntn_supersecret")).rejects.toThrow(/안전하게 저장할 수 없습니다/);
    await store.write("ntn_supersecret").catch((error: Error) => {
      expect(error.message).not.toContain("ntn_supersecret");
    });
    await expect(readFile(filePath, "utf8")).rejects.toThrow();
  });

  it("풀 수 없는 암호문은 토큰이 없는 것으로 다룬다", async () => {
    const filePath = await tempCredentialsPath();
    await createNotionTokenStore(filePath, {
      ...fakeSafeStorage(),
      encryptString: () => Buffer.from("other-machine", "utf8"),
    }).write("ntn_supersecret");
    const store = createNotionTokenStore(filePath, fakeSafeStorage());
    await expect(store.read()).resolves.toBeNull();
  });
});
