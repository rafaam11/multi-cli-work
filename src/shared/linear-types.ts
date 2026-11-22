/** 설정 화면이 보는 Linear 연결 상태 — 키 자체는 렌더러에 오지 않는다. */
export interface LinearKeyStatus {
  configured: boolean;
  encryptionAvailable: boolean;
  /** 마지막 브리프 조회가 실패한 사유. 다음 성공에서 지워진다. */
  lastError: string | null;
}

export type LinearHealth = "onTrack" | "atRisk" | "offTrack";

export interface LinearIssueSummary {
  identifier: string;
  title: string;
  stateName: string;
  stateType: string;
  dueDate: string | null;
  /** Linear 우선순위: 0 없음, 1 긴급 … 4 낮음. */
  priority: number;
  labels: string[];
}

export interface LinearUpdateSummary {
  health: LinearHealth | null;
  body: string;
  createdAt: string;
}

export interface LinearCommentSummary {
  issueIdentifier: string;
  body: string;
  createdAt: string;
}

export interface LinearProjectContext {
  name: string;
  url: string;
  issues: LinearIssueSummary[];
  updates: LinearUpdateSummary[];
  /** 모든 이슈의 댓글을 모아 최신순으로. */
  comments: LinearCommentSummary[];
}
