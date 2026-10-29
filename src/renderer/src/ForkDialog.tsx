import { useState } from "react";
import type { TerminalSessionView } from "@shared/api-types";

export function ForkDialog({ source, onClose, onCreated }: {
  source: TerminalSessionView; onClose(): void; onCreated(session: TerminalSessionView): void;
}) {
  const [name, setName] = useState(`${source.name || source.title || source.kind} · 분기`.slice(0, 120));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <div className="modal-backdrop"><section className="confirm-dialog handoff-dialog" role="dialog" aria-modal="true" aria-label="대화 분기">
    <h2>대화 분기</h2><p>원본 대화의 기록을 이어받은 새 세션을 만듭니다. 같은 작업 폴더의 파일은 공유합니다.</p>
    <p>{source.cwd}</p><label>새 세션 이름<input autoFocus maxLength={120} value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
    {error ? <p role="alert">{error}</p> : null}
    <footer className="confirm-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>취소</button><button type="button" disabled={busy || !name.trim()} onClick={() => {
      setBusy(true); setError(null);
      void window.multiCliWork.terminals.fork({ sourceSessionId: source.id, name: name.trim(), cols: 100, rows: 30 }).then(onCreated).catch(cause => setError(String(cause))).finally(() => setBusy(false));
    }}>{busy ? "분기 중…" : "새 대화로 분기"}</button></footer>
  </section></div>;
}
