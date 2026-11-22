import {
  createEncryptedTokenStore,
  type EncryptedTokenStore,
  type SafeStorageLike,
} from "../storage/encrypted-token-store";

/** 노션 통합 토큰 보관소 — 보관 방식은 `encrypted-token-store.ts`를 따른다. */
export type { SafeStorageLike };
export type NotionTokenStore = EncryptedTokenStore;

export function createNotionTokenStore(filePath: string, safeStorage: SafeStorageLike): NotionTokenStore {
  return createEncryptedTokenStore(filePath, safeStorage, {
    label: "notion credentials",
    displayName: "노션 자격 증명",
  });
}
