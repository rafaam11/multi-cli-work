import { notionLinkCheck, type NotionLinkCheck, type NotionTokenStatus } from "../../shared/notion-types";
import { inspectNotionLink, verifyNotionToken, type NotionClientOptions } from "./notion-client";
import type { NotionTokenStore } from "./notion-token-store";

export interface NotionService {
  status(): Promise<NotionTokenStatus>;
  /** 저장 전에 노션에 한 번 물어본다 — 오타난 토큰이 들어가 모든 링크가 실패로 보이는 걸 막는다. */
  setToken(token: string): Promise<NotionTokenStatus>;
  clearToken(): Promise<NotionTokenStatus>;
  inspectLink(url: string): Promise<NotionLinkCheck>;
}

export function createNotionService(store: NotionTokenStore, options: NotionClientOptions = {}): NotionService {
  const status = async (): Promise<NotionTokenStatus> => ({
    configured: (await store.read()) !== null,
    encryptionAvailable: store.encryptionAvailable(),
  });

  return {
    status,

    async setToken(token) {
      await verifyNotionToken(token, options);
      await store.write(token);
      return status();
    },

    async clearToken() {
      await store.clear();
      return status();
    },

    async inspectLink(url) {
      const token = await store.read();
      if (!token) return notionLinkCheck("no-token");
      return inspectNotionLink(token, url, options);
    },
  };
}
