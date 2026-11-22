import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "./json-store";

/**
 * 외부 서비스 토큰 하나를 담는 보관소. `settings.json`은 사용자가 열어보는 평문 파일이라 토큰을 두지
 * 않고, OS 자격 증명 저장소(Electron safeStorage)로 암호화한 뒤 별도 파일에 담는다.
 *
 * 토큰은 어떤 경로로도 렌더러에 돌려주지 않는다 — 화면은 "설정됨/안 됨"만 안다.
 */
class EncryptedTokenError extends Error {}

interface StoredToken {
  /** safeStorage 암호문의 base64. 미설정이면 null. */
  token: string | null;
}

/** Electron `safeStorage`에서 실제로 쓰는 부분만 추린 것 — 테스트에서 갈아끼운다. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface EncryptedTokenStore {
  encryptionAvailable(): boolean;
  read(): Promise<string | null>;
  write(token: string): Promise<void>;
  clear(): Promise<void>;
}

export interface EncryptedTokenLabels {
  /** 오류 메시지·로그용 영문 이름 (예: "notion credentials"). */
  label: string;
  /** 사용자에게 보이는 이름 (예: "노션 자격 증명"). */
  displayName: string;
}

function storeSpec(labels: EncryptedTokenLabels): JsonStoreSpec<StoredToken> {
  const parse = (value: unknown): StoredToken => {
    if (value === undefined || value === null) return { token: null };
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new EncryptedTokenError(`${labels.label} must be an object`);
    }
    const token = (value as Record<string, unknown>).token;
    if (token === undefined || token === null) return { token: null };
    // 값 자체는 메시지에 담지 않는다.
    if (typeof token !== "string") throw new EncryptedTokenError(`${labels.label} token must be a string`);
    return { token };
  };
  return {
    label: labels.label,
    displayName: labels.displayName,
    parse,
    empty: () => ({ token: null }),
    error: (message, options) => new EncryptedTokenError(message, options),
    isContentError: (error) => error instanceof EncryptedTokenError,
  };
}

export function createEncryptedTokenStore(
  filePath: string,
  safeStorage: SafeStorageLike,
  labels: EncryptedTokenLabels,
): EncryptedTokenStore {
  const spec = storeSpec(labels);
  return {
    encryptionAvailable: () => safeStorage.isEncryptionAvailable(),

    async read() {
      const stored = (await readJsonStore(spec, filePath)).value.token;
      if (!stored) return null;
      try {
        return safeStorage.decryptString(Buffer.from(stored, "base64"));
      } catch {
        // 다른 기기나 다른 OS 계정이 쓴 암호문은 풀리지 않는다 — 토큰이 없는 것과 같이 다룬다.
        return null;
      }
    },

    async write(token) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("이 환경에서는 토큰을 안전하게 저장할 수 없습니다");
      }
      const encrypted = safeStorage.encryptString(token).toString("base64");
      await updateJsonStore(spec, filePath, () => ({ token: encrypted }));
    },

    async clear() {
      await updateJsonStore(spec, filePath, () => ({ token: null }));
    },
  };
}
