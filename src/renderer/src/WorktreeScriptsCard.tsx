import type { WorktreeScripts } from "@shared/worktree-types";
import { useEffect, useState } from "react";
import { errorMessage } from "./ipc-error";

const EMPTY: WorktreeScripts = { setup: "", teardown: "", teardownTimeoutSec: 120 };

const sameScripts = (a: WorktreeScripts, b: WorktreeScripts) =>
  a.setup === b.setup && a.teardown === b.teardown && a.teardownTimeoutSec === b.teardownTimeoutSec;

/**
 * 폴더별 워크트리 스크립트. 준비 스크립트는 새 워크트리에서 보이는 셸 세션으로 돌고(npm ci 같은 것은
 * 지켜볼 일이다), 정리 스크립트는 제거 전에 숨어서 돈다 — 실패하면 제거가 멈춘다. 앱 설정에만 있고
 * 레포에는 아무것도 쓰지 않는다.
 */
export function WorktreeScriptsCard({ projectId }: { projectId: string }) {
  const [saved, setSaved] = useState<WorktreeScripts | null>(null);
  const [draft, setDraft] = useState<WorktreeScripts>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const windows = window.multiCliWork.platform === "win32";

  useEffect(() => {
    let disposed = false;
    setSaved(null);
    void window.multiCliWork.worktreeScripts
      .get(projectId)
      .then((scripts) => {
        if (disposed) return;
        setSaved(scripts ?? EMPTY);
        setDraft(scripts ?? EMPTY);
      })
      .catch((cause) => {
        if (!disposed) setError(errorMessage(cause));
      });
    return () => {
      disposed = true;
    };
  }, [projectId]);

  const dirty = saved !== null && !sameScripts(saved, draft);
  const edit = (patch: Partial<WorktreeScripts>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setJustSaved(false);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await window.multiCliWork.worktreeScripts.set(projectId, draft);
      setSaved(draft);
      setJustSaved(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const shell = windows ? "PowerShell" : "bash";
  return (
    <section className="detail-card detail-card-scripts" aria-label="워크트리 스크립트">
      <h2>워크트리 스크립트</h2>
      <p className="detail-scripts-hint">
        새 워크트리를 만들면 <strong>준비 스크립트</strong>가 그 워크트리의 {shell} 세션에서 돈다. 제거할 때는{" "}
        <strong>정리 스크립트</strong>가 먼저 돌고, 실패하면 제거를 멈춘다. <code>MCW_ROOT_PATH</code> ·{" "}
        <code>MCW_WORKTREE_PATH</code> · <code>MCW_BRANCH</code> 환경 변수를 쓸 수 있다.
      </p>
      {error ? (
        <p className="detail-save-error" role="alert">
          {error}
        </p>
      ) : null}
      <label className="detail-scripts-field">
        <span>준비 스크립트</span>
        <textarea
          aria-label="준비 스크립트"
          spellCheck={false}
          rows={4}
          disabled={saved === null}
          value={draft.setup}
          placeholder={windows ? 'npm ci\nCopy-Item "$env:MCW_ROOT_PATH\\.env" .' : 'npm ci\ncp "$MCW_ROOT_PATH/.env" .'}
          onChange={(event) => edit({ setup: event.target.value })}
        />
      </label>
      <label className="detail-scripts-field">
        <span>정리 스크립트</span>
        <textarea
          aria-label="정리 스크립트"
          spellCheck={false}
          rows={3}
          disabled={saved === null}
          value={draft.teardown}
          placeholder={windows ? "docker compose down" : "docker compose down"}
          onChange={(event) => edit({ teardown: event.target.value })}
        />
      </label>
      <div className="detail-scripts-actions">
        <label className="detail-scripts-timeout">
          <span>정리 제한 시간(초)</span>
          <input
            type="number"
            aria-label="정리 제한 시간(초)"
            min={1}
            max={3600}
            disabled={saved === null}
            value={draft.teardownTimeoutSec}
            onChange={(event) => edit({ teardownTimeoutSec: Math.trunc(Number(event.target.value)) || 1 })}
          />
        </label>
        {justSaved && !dirty ? <span className="detail-scripts-saved">저장했습니다</span> : null}
        <button type="button" onClick={() => void save()} disabled={!dirty || saving} aria-label="스크립트 저장">
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
    </section>
  );
}
