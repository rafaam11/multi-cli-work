import { useState } from "react";
import type { SharedProject } from "@shared/project-types";
import type { SharedWorktree } from "@shared/worktree-types";
import { projectName } from "./session-labels";

interface WorktreeCreateDialogProps {
  project: SharedProject;
  onCreated(worktree: SharedWorktree): void;
  onClose(): void;
}

/** Creation errors (branch exists, not a repo…) stay inside the dialog so the input isn't lost. */
export function WorktreeCreateDialog({ project, onCreated, onClose }: WorktreeCreateDialogProps) {
  const [branch, setBranch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const trimmed = branch.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      onCreated(await window.multiCliWork.worktrees.create(project.id, trimmed));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPending(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="Worktree 만들기">
        <h2>{projectName(project)}에 worktree 만들기</h2>
        <p>새 브랜치가 저장소 옆의 전용 폴더에 체크아웃되고, 그 안의 세션은 서로를 밟지 않습니다.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            type="text"
            className="worktree-branch-input"
            aria-label="브랜치 이름"
            placeholder="예: feature/parallel-work"
            autoFocus
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
            }}
          />
          {error ? (
            <p className="detail-save-error" role="alert">
              {error}
            </p>
          ) : null}
          <footer className="confirm-dialog-actions">
            <button type="button" onClick={onClose}>
              취소
            </button>
            <button type="submit" disabled={branch.trim().length === 0 || pending}>
              {pending ? "만드는 중…" : "만들기"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
