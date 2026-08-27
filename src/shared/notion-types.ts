/**
 * 노션 링크 한 줄에 대한 검증 결과.
 *
 * 제목 조회와 접근성 검증은 같은 한 번의 호출이다: 통합 토큰으로 제목을 읽어올 수 있다는 것은
 * 그 페이지가 통합에 연결돼 있다는 뜻이고, 곧 노션 MCP도 그 페이지를 쓸 수 있다는 뜻이다.
 * 반대로 제목을 못 읽으면 링크 자체는 브라우저에서 열려도 MCP에서는 보이지 않는다.
 */
export type NotionLinkCheckState =
  | "ok"
  | "not-shared"
  | "unauthorized"
  | "rate-limited"
  | "no-token"
  | "not-notion"
  | "network-error";

export interface NotionLinkCheck {
  state: NotionLinkCheckState;
  /** 조회에 성공했고 제목이 비어있지 않을 때만 채워진다. */
  title: string | null;
  /** 사용자에게 보일 한국어 설명. state가 "ok"면 null. */
  message: string | null;
}

export interface NotionTokenStatus {
  configured: boolean;
  /** false면 이 환경에서 안전한 저장이 불가능하다 — 토큰 입력을 막는다. */
  encryptionAvailable: boolean;
}

const MESSAGES: Record<Exclude<NotionLinkCheckState, "ok">, string> = {
  "not-shared": "이 페이지는 노션 통합에 연결되어 있지 않습니다 (MCP에서도 접근 불가)",
  unauthorized: "노션 토큰이 유효하지 않습니다 — 설정에서 다시 입력하세요",
  "rate-limited": "노션 요청 한도를 초과했습니다 — 잠시 후 다시 시도하세요",
  "no-token": "설정 → 노션에서 통합 토큰을 먼저 입력하세요",
  "not-notion": "노션 URL이 아닙니다",
  "network-error": "노션에 연결할 수 없습니다",
};

export function notionCheckMessage(state: NotionLinkCheckState): string | null {
  return state === "ok" ? null : MESSAGES[state];
}

export function notionLinkCheck(state: NotionLinkCheckState, title: string | null = null): NotionLinkCheck {
  return { state, title, message: notionCheckMessage(state) };
}
