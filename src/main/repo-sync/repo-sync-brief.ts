import type { RepoSyncReport } from "../../shared/repo-sync-types";
import type { RepoSyncService } from "./repo-sync-service";

/** 세션 시작에서 HM이 중간 보고서를 쓰기까지 기다리는 시간(계약 §7). */
export const SESSION_START_WAIT_MS = 3_000;
/** 그 위에 spawn 비용까지 더한 바깥 상한. 이 안에 답이 없으면 브리프 없이 세션을 띄운다. */
export const SESSION_START_DEADLINE_MS = 3_500;

export interface SessionRepoSync {
  /** 브리프에 붙일 "레포 최신화" 절. Claude·Codex 둘 다 SessionStart hook으로 받는다. */
  section: string | null;
  /** 같은 보고서 — 건너뜀·실패를 앱 알림으로도 띄우는 데 쓴다. */
  report: RepoSyncReport | null;
}

const NOTHING: SessionRepoSync = { section: null, report: null };

/**
 * 세션 시작 최신화. 어떤 실패·지연도 빈 결과로 끝난다 — 버튼으로 시작된 긴 실행에 합류하더라도 바깥
 * 상한이 세션 시작을 붙잡지 않게 한다.
 */
export async function repoSyncForSession(
  service: RepoSyncService,
  workProjectId: string,
  deadlineMs: number = SESSION_START_DEADLINE_MS,
): Promise<SessionRepoSync> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), deadlineMs);
  });
  try {
    const result = await Promise.race([
      service.sync(workProjectId, { force: false, waitMs: SESSION_START_WAIT_MS }).catch(() => null),
      deadline,
    ]);
    if (!result) return NOTHING;
    const { report } = result;
    return {
      section: report.summary ? `## 레포 최신화 (세션 시작 시점)\n\n${report.summary}\n` : null,
      report,
    };
  } finally {
    clearTimeout(timer);
  }
}
