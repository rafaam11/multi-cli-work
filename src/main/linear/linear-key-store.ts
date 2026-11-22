import {
  createEncryptedTokenStore,
  type EncryptedTokenStore,
  type SafeStorageLike,
} from "../storage/encrypted-token-store";

/**
 * Linear 개인 API 키 보관소(`userData/linear-credentials.json`). 키는 세션 환경변수로도 넘기지 않는다 —
 * 세션의 `linear` CLI는 자기 인증을 따로 쓴다.
 */
export type LinearKeyStore = EncryptedTokenStore;

export function createLinearKeyStore(filePath: string, safeStorage: SafeStorageLike): LinearKeyStore {
  return createEncryptedTokenStore(filePath, safeStorage, {
    label: "linear credentials",
    displayName: "Linear 자격 증명",
  });
}
