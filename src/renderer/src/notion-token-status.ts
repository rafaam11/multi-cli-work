import type { NotionTokenStatus } from "@shared/notion-types";

/**
 * 토큰은 설정 다이얼로그에서 바뀌지만 그 결과를 봐야 하는 곳은 업무 프로젝트 상세 페이지다.
 * 둘 사이에 공통 부모가 없어서 작은 구독 창구만 둔다 — 값은 캐시하지 않는다. 각 화면은 마운트할 때
 * 메인 프로세스에 직접 묻고, 여기서는 "방금 바뀌었다"는 사실만 흘려보낸다.
 */
const listeners = new Set<(status: NotionTokenStatus) => void>();

export function publishNotionTokenStatus(status: NotionTokenStatus): void {
  for (const listener of listeners) listener(status);
}

export function subscribeNotionTokenStatus(listener: (status: NotionTokenStatus) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
