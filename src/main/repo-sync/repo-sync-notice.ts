import path from "node:path";
import {
  REPO_FAIL_LABELS,
  REPO_SKIP_LABELS,
  type RepoSyncReport,
  type RepoSyncSessionNotice,
} from "../../shared/repo-sync-types";

/** 같은 업무 프로젝트에 같은 알림을 다시 띄우지 않는 기간. 엔진 쿨다운과 같다. */
export const NOTICE_REPEAT_MS = 10 * 60_000;

function repoName(target: string): string {
  return path.win32.basename(target) || target;
}

/** 건너뜀·실패가 없으면 null — 다 최신이면 조용히 지나간다. 아직 도는 레포(pending)는 알리지 않는다. */
export function sessionNotice(
  workProjectId: string,
  sessionId: string,
  report: RepoSyncReport,
): RepoSyncSessionNotice | null {
  const skipped = report.results
    .filter((result) => result.status === "skipped")
    .map((result) => ({ name: repoName(result.path), reason: result.reason ? REPO_SKIP_LABELS[result.reason] : "사유 없음" }));
  const failed = report.results
    .filter((result) => result.status === "failed")
    .map((result) => ({ name: repoName(result.path), reason: result.failKind ? REPO_FAIL_LABELS[result.failKind] : "알 수 없음" }));
  if (skipped.length === 0 && failed.length === 0) return null;
  return { workProjectId, label: report.label ?? "", sessionId, skipped, failed };
}

/**
 * 세션 여러 개를 한꺼번에 띄우면 같은 업무 프로젝트에서 같은 알림이 세션 수만큼 온다. 내용이 같고
 * `repeatMs` 안이면 한 번만 내보낸다. 내용이 바뀌면(새로 건너뛴 레포 등) 곧바로 다시 알린다.
 */
export function createNoticeGate(repeatMs: number = NOTICE_REPEAT_MS) {
  const last = new Map<string, { signature: string; at: number }>();
  return (notice: RepoSyncSessionNotice, now: number): boolean => {
    const signature = JSON.stringify([notice.skipped, notice.failed]);
    const previous = last.get(notice.workProjectId);
    if (previous && previous.signature === signature && now - previous.at < repeatMs) return false;
    last.set(notice.workProjectId, { signature, at: now });
    return true;
  };
}
