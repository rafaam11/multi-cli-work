import type { LinearKeyStatus, LinearProjectContext } from "../../shared/linear-types";
import { renderLinearBrief } from "./linear-brief";
import {
  fetchLinearProjectContext,
  linearFailureMessage,
  verifyLinearKey,
  type LinearClientOptions,
} from "./linear-client";
import type { LinearKeyStore } from "./linear-key-store";

/** 세션 시작이 Linear를 기다리는 최대 시간(설계 §4.3) — 넘으면 절 없이 세션을 띄운다. */
const BRIEF_DEADLINE_MS = 3_000;
/** 같은 PRJ의 세션을 연달아 열어도 다시 묻지 않는 시간. */
const CACHE_TTL_MS = 5 * 60_000;

export interface LinearServiceOptions extends LinearClientOptions {
  deadlineMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
}

export interface LinearBriefRequest {
  prjKey: string;
  repoName: string | null;
  recordReminder: boolean;
}

export interface LinearService {
  status(): Promise<LinearKeyStatus>;
  /** 저장 전에 Linear에 한 번 물어본다 — 거절된 키는 저장하지 않는다. */
  setKey(key: string): Promise<LinearKeyStatus>;
  clearKey(): Promise<LinearKeyStatus>;
  /** 키 없음·프로젝트 없음·실패·상한 초과는 모두 null — 세션 시작을 막지 않는다. */
  briefSection(request: LinearBriefRequest): Promise<string | null>;
}

export function createLinearService(store: LinearKeyStore, options: LinearServiceOptions = {}): LinearService {
  const now = options.now ?? Date.now;
  const deadlineMs = options.deadlineMs ?? BRIEF_DEADLINE_MS;
  const cacheTtlMs = options.cacheTtlMs ?? CACHE_TTL_MS;
  // 렌더한 문자열이 아니라 맥락을 둔다 — 같은 PRJ라도 레포마다 정렬이 다르다.
  const cache = new Map<string, { context: LinearProjectContext; at: number }>();
  let lastError: string | null = null;

  const status = async (): Promise<LinearKeyStatus> => ({
    configured: (await store.read()) !== null,
    encryptionAvailable: store.encryptionAvailable(),
    lastError,
  });

  const reset = () => {
    cache.clear();
    lastError = null;
  };

  const contextFor = async (prjKey: string): Promise<{ context: LinearProjectContext; at: number } | null> => {
    const cached = cache.get(prjKey);
    if (cached && now() - cached.at < cacheTtlMs) return cached;
    const key = await store.read();
    if (!key) return null;
    const result = await fetchLinearProjectContext(key, prjKey, options);
    if (result.kind !== "ok") {
      lastError = linearFailureMessage(result.kind);
      return null;
    }
    lastError = null;
    const fresh = { context: result.context, at: now() };
    cache.set(prjKey, fresh);
    return fresh;
  };

  return {
    status,

    async setKey(key) {
      await verifyLinearKey(key, options);
      await store.write(key);
      reset();
      return status();
    },

    async clearKey() {
      await store.clear();
      reset();
      return status();
    },

    async briefSection(request) {
      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deadlineMs);
      });
      try {
        const found = await Promise.race([contextFor(request.prjKey).catch(() => null), deadline]);
        if (!found) return null;
        return renderLinearBrief({
          prjKey: request.prjKey,
          repoName: request.repoName,
          context: found.context,
          // 캐시에서 꺼낸 맥락은 처음 조회한 시각을 보인다 — 얼마나 묵었는지가 브리프에 드러나게.
          fetchedAt: new Date(found.at),
          recordReminder: request.recordReminder,
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
