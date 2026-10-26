import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import {
  REPO_FAIL_LABELS,
  REPO_SKIP_LABELS,
  type RepoResult,
  type RepoSyncSessionNotice,
  type WorkProjectRepoSync,
} from "@shared/repo-sync-types";
import { errorMessage } from "./ipc-error";
import { relativeTime } from "./session-labels";
import type { ToastInput } from "./toast";

/** 세션 시작 최신화 알림 한 장. 실패가 하나라도 있으면 error, 건너뜀뿐이면 warning이다. */
export function repoSyncNoticeToast(notice: RepoSyncSessionNotice, onSelect: () => void): ToastInput {
  const counts = [
    notice.failed.length > 0 ? `${notice.failed.length}개 실패` : null,
    notice.skipped.length > 0 ? `${notice.skipped.length}개 건너뜀` : null,
  ].filter(Boolean);
  return {
    tone: notice.failed.length > 0 ? "error" : "warning",
    title: `${notice.label ? `${notice.label} ` : ""}레포 최신화: ${counts.join(", ")}`,
    detail: [...notice.failed, ...notice.skipped].map((repo) => `${repo.name}(${repo.reason})`).join(", "),
    onSelect,
  };
}

function baseName(target: string): string {
  return target.split(/[\\/]/).filter(Boolean).pop() ?? target;
}

/** 레포 한 줄의 상태 문구와 색 갈래. 문구는 HM 공유 라벨표를 그대로 쓴다(계약 §2). */
export function repoStatus(result: RepoResult): { text: string; tone: "ok" | "quiet" | "warn" | "danger" } {
  switch (result.status) {
    case "updated":
      return { text: `최신화됨 (${result.commits ?? 0}커밋)`, tone: "ok" };
    case "up-to-date":
      return { text: result.ahead ? `이미 최신 · 로컬이 ${result.ahead}커밋 앞섬` : "이미 최신", tone: "quiet" };
    case "skipped":
      return { text: `건너뜀 · ${result.reason ? REPO_SKIP_LABELS[result.reason] : "사유 없음"}`, tone: "warn" };
    case "failed":
      return { text: `실패 · ${result.failKind ? REPO_FAIL_LABELS[result.failKind] : "알 수 없음"}`, tone: "danger" };
  }
}

/**
 * 업무 프로젝트에 묶인 레포(레포 멤버 + 셸 `repos:`·`external_paths:`)를 한 번에 fast-forward한다. 들어오면
 * 마지막 기록을 보여 주고, 버튼은 쿨다운을 무시하고 끝까지 돈 결과로 바꾼다.
 */
export function WorkProjectRepoSyncCard({ workProjectId }: { workProjectId: string }) {
  const [sync, setSync] = useState<WorkProjectRepoSync | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSync(null);
    setError(null);
    window.multiCliWork.workProjects
      .lastRepoSync(workProjectId)
      .then((value) => {
        if (!cancelled) setSync(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [workProjectId]);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setSync(await window.multiCliWork.workProjects.syncRepos(workProjectId));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setRunning(false);
    }
  };

  const report = sync?.report;
  const rows: { path: string; result: RepoResult | null }[] = report
    ? [...report.results.map((result) => ({ path: result.path, result })), ...report.pending.map((path) => ({ path, result: null }))]
    : [];
  const lastFinished = report?.results.map((result) => result.finishedAt).sort().at(-1);

  return (
    <section className="detail-card" aria-label="레포 최신화">
      <div className="detail-card-header">
        <h2>레포 최신화</h2>
        <button type="button" onClick={() => void run()} disabled={running} aria-label="모든 레포 최신화">
          <RefreshCw size={14} className={running ? "spin" : undefined} />
          <span>{running ? "최신화 중…" : "모든 레포 최신화"}</span>
        </button>
      </div>
      {error ? <p className="detail-save-error">{error}</p> : null}
      {rows.length === 0 ? (
        <p className="detail-empty">레포 멤버나 연결된 셸의 레포가 없습니다.</p>
      ) : (
        <ul className="repo-sync-list">
          {rows.map(({ path, result }) => {
            // 화면은 waitMs 없이 끝까지 돌리므로 pending은 "아직 한 번도 돌지 않은 레포"뿐이다.
            const status = result ? repoStatus(result) : { text: "기록 없음", tone: "quiet" as const };
            return (
              <li key={path}>
                <span className="member-copy">
                  <span className="member-name">{baseName(path)}</span>
                  <span className="member-path" title={path}>
                    {path}
                  </span>
                </span>
                <span className={`repo-sync-status repo-sync-${status.tone}`} title={result?.error ?? undefined}>
                  {status.text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {report ? (
        <p className="repo-sync-meta">
          {lastFinished ? `마지막 실행 ${relativeTime(lastFinished)}` : "실행 기록 없음"} ·{" "}
          {sync?.source === "hm" ? "Harness Manager" : "내장 엔진"} · fast-forward만 하고 로컬 변경·갈라진 레포는 건너뜁니다
        </p>
      ) : null}
    </section>
  );
}
