import type { ReactNode } from "react";
import type { OpenFileTab } from "../file-tabs";
import type { RemovalState, WorktreeForceState, WorktreeRemovalState } from "./app-model";
import type { RunConfirmRequest } from "./file-tab-actions";

/** App이 띄우는 확인 대화상자들. 상태와 동작은 App에 있고, 여기는 그리기만 한다. */

function ConfirmFrame({ label, title, children }: { label: string; title: ReactNode; children: ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label={label}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function WorktreeRemovalDialog({
  removal,
  busy,
  onCancel,
  onConfirm,
}: {
  removal: WorktreeRemovalState;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <ConfirmFrame label="Worktree 제거" title={`${removal.worktree.branch} worktree를 제거할까요?`}>
      <p>
        이 worktree의 세션 {removal.sessionCount}개가 중지되고 스크롤백이 삭제됩니다. 커밋한 내용은
        브랜치로 저장소에 남습니다.
      </p>
      <footer className="confirm-dialog-actions">
        <button type="button" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="danger-button" disabled={busy} onClick={onConfirm}>
          제거
        </button>
      </footer>
    </ConfirmFrame>
  );
}

export function WorktreeForceDialog({
  force,
  busy,
  onCancel,
  onConfirm,
}: {
  force: WorktreeForceState;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <ConfirmFrame label="Worktree 강제 제거" title="커밋되지 않은 변경이 있습니다">
      <p>{force.message} 강제 제거하면 이 변경은 되돌릴 수 없이 사라집니다.</p>
      <footer className="confirm-dialog-actions">
        <button type="button" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="danger-button" disabled={busy} onClick={onConfirm}>
          변경을 버리고 강제 제거
        </button>
      </footer>
    </ConfirmFrame>
  );
}

export function UnsavedFileDialog({
  tab,
  onCancel,
  onSaveAndClose,
  onDiscard,
}: {
  tab: OpenFileTab;
  onCancel(): void;
  onSaveAndClose(): void;
  onDiscard(): void;
}) {
  return (
    <ConfirmFrame label="저장하지 않은 변경 사항" title={`${tab.name}에 저장하지 않은 변경 사항이 있습니다`}>
      <p>닫으면 이 변경 사항이 되돌릴 수 없이 사라집니다.</p>
      <footer className="confirm-dialog-actions">
        <button type="button" onClick={onCancel}>
          취소
        </button>
        <button type="button" onClick={onSaveAndClose}>
          저장 후 닫기
        </button>
        <button type="button" className="danger-button" onClick={onDiscard}>
          변경 사항 버리기
        </button>
      </footer>
    </ConfirmFrame>
  );
}

export function RunConfirmDialog({
  request,
  onCancel,
  onRun,
}: {
  request: RunConfirmRequest;
  onCancel(): void;
  onRun(): void;
}) {
  const run = request.mode === "run";
  return (
    <ConfirmFrame label="실행 확인" title={run ? "이 프로그램을 실행할까요?" : "이 파일은 열면 바로 실행됩니다"}>
      <p>{request.entry.relativePath}</p>
      {request.error ? <p className="file-viewer-error" role="alert">{request.error}</p> : null}
      <footer className="confirm-dialog-actions">
        <button type="button" disabled={request.running} onClick={onCancel}>취소</button>
        <button type="button" className="danger-button" disabled={request.running} onClick={onRun}>
          {request.running ? (run ? "실행 중" : "여는 중") : (run ? "실행" : "실행하고 열기")}
        </button>
      </footer>
    </ConfirmFrame>
  );
}

export function FolderRemovalDialog({
  removal,
  name,
  busy,
  onCancel,
  onConfirm,
}: {
  removal: RemovalState;
  name: string;
  busy: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  return (
    <ConfirmFrame label="목록에서 폴더 제거" title={`${name}을(를) 목록에서 제거할까요?`}>
      <p>
        이 폴더의 세션 {removal.sessionCount}개가 중지되고 스크롤백이 삭제됩니다. 폴더 자체는 디스크에 그대로
        남습니다.
      </p>
      <footer className="confirm-dialog-actions">
        <button type="button" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="danger-button" onClick={onConfirm} disabled={busy}>
          제거
        </button>
      </footer>
    </ConfirmFrame>
  );
}
