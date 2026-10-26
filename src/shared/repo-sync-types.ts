// 출처: harness-manager src/shared/repo-sync-types.ts — 계약 harness-manager docs/contracts/repo-sync.md. HM과 같이 고친다.
/**
 * 레포 일괄 최신화(repo-sync) 계약. HM의 `hm repos sync` 출력과 `~/.harness-manager/repo-sync/state.json`이
 * 이 형태이고, multi-cli-work가 같은 형태로 읽는다 — 전문은 `docs/contracts/repo-sync.md`.
 * 필드는 optional로만 늘린다. 읽는 쪽은 모르는 키를 무시해야 한다.
 */

export type RepoSyncStatus = "updated" | "up-to-date" | "skipped" | "failed";

export type RepoSkipReason =
  | "missing"
  | "not-a-repo"
  | "cloud-sync"
  | "detached"
  | "no-upstream"
  | "dirty"
  | "in-progress-op"
  | "diverged";

export type RepoFailKind = "network" | "auth" | "timeout" | "overwrite" | "git";

export interface RepoResult {
  /** 호출자가 준 경로를 `path.resolve`한 원형. 키로는 `repoSyncKey(path)`를 쓴다. */
  path: string;
  status: RepoSyncStatus;
  reason?: RepoSkipReason;
  failKind?: RepoFailKind;
  /** git stderr의 마지막 줄. 실패일 때만. */
  error?: string;
  /** 이번에 받아 온 커밋 수(`updated`일 때). */
  commits?: number;
  ahead?: number;
  behind?: number;
  branch?: string;
  upstream?: string;
  /** canonical ISO. */
  finishedAt: string;
  /** 이번 호출에서 git을 돌리지 않고 쿨다운·다른 실행의 결과를 재사용했으면 true. */
  cached: boolean;
}

export interface RepoSyncReport {
  schemaVersion: 1;
  label?: string;
  startedAt: string;
  finishedAt: string;
  results: RepoResult[];
  /** `waitMs` 안에 끝나지 않아 아직 도는 레포의 경로. 결과는 끝나는 대로 state.json에 남는다. */
  pending: string[];
  /** 세션 컨텍스트에 그대로 넣을 수 있는 한국어 한 블록. */
  summary: string;
}

export const REPO_SKIP_LABELS: Record<RepoSkipReason, string> = {
  missing: "경로 없음",
  "not-a-repo": "git 레포 아님",
  "cloud-sync": "클라우드 동기화 폴더",
  detached: "detached HEAD",
  "no-upstream": "upstream 없음",
  dirty: "로컬 변경",
  "in-progress-op": "merge·rebase 진행 중",
  diverged: "로컬과 원격이 갈라짐",
};

export const REPO_FAIL_LABELS: Record<RepoFailKind, string> = {
  network: "네트워크 오류",
  auth: "인증 실패",
  timeout: "시간 초과",
  overwrite: "추적 안 된 파일을 덮어써야 함",
  git: "git 오류",
};

/** multi-cli-work 전용(HM 계약 밖). 보고서와 그것을 만든 쪽 — 설치된 HM CLI인지, mcw 대체 구현인지. */
export interface WorkProjectRepoSync {
  report: RepoSyncReport;
  source: "hm" | "fallback";
}

/**
 * multi-cli-work 전용. 세션 시작 최신화에서 건너뜀·실패가 나왔을 때 렌더러에 보내는 알림. 이름은 레포 폴더명,
 * 사유는 위 라벨표의 문구다.
 */
export interface RepoSyncSessionNotice {
  workProjectId: string;
  label: string;
  sessionId: string;
  skipped: { name: string; reason: string }[];
  failed: { name: string; reason: string }[];
}
