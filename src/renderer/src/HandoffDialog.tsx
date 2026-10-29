import { useState } from "react";
import type { TerminalSessionView } from "@shared/api-types";

export function HandoffDialog({ source, sessions, selection, onClose, onDone }: {
  source: TerminalSessionView; sessions: TerminalSessionView[]; selection: string;
  onClose(): void; onDone(): void;
}) {
  const [target, setTarget] = useState("");
  const [request, setRequest] = useState("");
  const [context, setContext] = useState(selection.slice(0, 5000));
  const [paths, setPaths] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = source.name || source.title || source.kind;
  const text = [`[Handoff from ${label} (${source.kind})]`, `Working directory: ${source.cwd}`, paths.trim() ? `Files:\n${paths.trim()}` : "", context.trim() ? `Selected context:\n${context.trim()}` : "", `Request:\n${request.trim()}`].filter(Boolean).join("\n\n");
  return <div className="modal-backdrop"><section className="confirm-dialog handoff-dialog" role="dialog" aria-modal="true" aria-label="세션 인계">
    <h2>{label}에서 작업 인계</h2>
    <p>선택한 출력과 요청을 확인한 뒤 팀 보드와 전달 큐로 보냅니다.</p>
    {selection.length > 5000 ? <p>선택 출력 중 처음 5,000자만 초안에 포함했습니다.</p> : null}
    <label>대상 세션<select value={target} disabled={busy} onChange={event => setTarget(event.target.value)}><option value="">대상 선택</option>{sessions.filter(session => session.id !== source.id && session.projectId === source.projectId && session.pid !== null && session.status !== "exited" && session.status !== "error").map(session => <option key={session.id} value={session.id}>{session.kind} · {session.name || session.title || session.id.slice(0, 8)}</option>)}</select></label>
    <label>요청<textarea autoFocus disabled={busy} maxLength={2000} value={request} onChange={event => setRequest(event.target.value)} /></label>
    <label>선택한 출력<textarea disabled={busy} maxLength={5000} value={context} onChange={event => setContext(event.target.value)} /></label>
    <label>관련 파일 경로<input disabled={busy} maxLength={1000} value={paths} onChange={event => setPaths(event.target.value)} /></label>
    <details><summary>전송 내용 미리보기 ({text.length}/8000)</summary><pre>{text}</pre></details>
    {error ? <p role="alert">{error}</p> : null}
    <footer className="confirm-dialog-actions"><button type="button" disabled={busy} onClick={onClose}>취소</button><button type="button" disabled={busy || !target || !request.trim() || text.length > 8000 || !source.projectId} onClick={() => {
      if (!source.projectId) return;
      setBusy(true); setError(null);
      void window.multiCliWork.board.post({ projectId: source.projectId, text, mentions: [target] }).then(onDone).catch(cause => setError(String(cause))).finally(() => setBusy(false));
    }}>인계 전송</button></footer>
  </section></div>;
}
