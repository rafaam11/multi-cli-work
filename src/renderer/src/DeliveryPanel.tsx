import { useEffect, useState } from "react";
import type { TerminalSessionView } from "@shared/api-types";
import type { DeliveryRecord } from "@shared/delivery-types";

const REASONS: Record<string, string> = {
  working: "응답 중", "awaiting-approval": "승인 대기", typing: "사용자 입력 중",
  starting: "시작 중", settling: "입력 준비 중", dialog: "CLI 대화상자 표시 중",
};
const STATES = { held: "보류", delivered: "터미널 전달됨", failed: "전달 실패", dropped: "취소됨" };

export function DeliveryPanel({ hidden, sessions, onFocusSession }: {
  hidden: boolean; sessions: TerminalSessionView[]; onFocusSession(session: TerminalSessionView): void;
}) {
  const [records, setRecords] = useState<DeliveryRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (hidden) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const list = await window.multiCliWork.deliveries.list();
        if (!disposed) setRecords(list);
      } catch (cause) { if (!disposed) setError(String(cause)); }
      if (!disposed) timer = setTimeout(() => void refresh(), 1000);
    };
    void refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, [hidden]);
  const perform = async (action: () => Promise<DeliveryRecord | null>) => {
    setBusy(true); setError(null);
    try {
      const result = await action();
      if (!result) throw new Error("메시지가 이미 전송되었거나 처리 중입니다. 목록을 새로 확인해 주세요.");
      setRecords(current => current.map(record => record.id === result.id ? result : record));
      setEditing(null);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  return <section className="delivery-panel" hidden={hidden} aria-label="보류 메시지 관리">
    <header><h2>메시지 전달</h2><p>보류 {records.filter(record => record.state === "held").length}개 · 전달됨은 CLI의 실행 완료를 뜻하지 않습니다.</p></header>
    {error ? <p role="alert">{error}</p> : null}
    {records.length === 0 ? <p>보류하거나 전달한 메시지가 없습니다.</p> : null}
    <ol className="delivery-list">{[...records.filter(record => record.state === "held"), ...records.filter(record => record.state !== "held").reverse()].map(record => {
      const session = sessions.find(candidate => candidate.id === record.to);
      return <li key={record.id} className={`delivery-card delivery-${record.state}`}>
        <div className="delivery-heading"><button type="button" disabled={!session} onClick={() => session && onFocusSession(session)}>{session?.name || session?.title || session?.kind || "종료된 세션"}</button><span>{STATES[record.state]}</span></div>
        <time dateTime={new Date(record.createdAt).toISOString()}>{new Date(record.createdAt).toLocaleTimeString()}</time>
        {editing === record.id ? <textarea aria-label="보류 메시지 수정" maxLength={8000} value={text} onChange={event => setText(event.target.value)} /> : <pre>{record.text}</pre>}
        {record.reason ? <p>{REASONS[record.reason] ?? record.reason}</p> : null}
        {record.state === "held" ? <div className="delivery-actions">
          <button type="button" disabled={busy} aria-label="같은 대상의 앞 메시지로 이동" onClick={() => void perform(() => window.multiCliWork.deliveries.move(record.id, "up"))}>↑</button>
          <button type="button" disabled={busy} aria-label="같은 대상의 뒤 메시지로 이동" onClick={() => void perform(() => window.multiCliWork.deliveries.move(record.id, "down"))}>↓</button>
          {editing === record.id ? <><button type="button" disabled={busy || !text.trim()} onClick={() => void perform(() => window.multiCliWork.deliveries.edit(record.id, text))}>저장</button><button type="button" disabled={busy} onClick={() => setEditing(null)}>수정 닫기</button></> : <button type="button" disabled={busy} onClick={() => { setEditing(record.id); setText(record.text); }}>수정</button>}
          <button type="button" disabled={busy} onClick={() => void perform(() => window.multiCliWork.deliveries.drop(record.id))}>전달 취소</button>
          <button type="button" disabled={busy} title="응답 중 보류만 해제합니다. 사용자 입력·승인·대화상자 보호는 유지됩니다." onClick={() => void perform(() => window.multiCliWork.deliveries.sendNow(record.id))}>지금 전달</button>
        </div> : null}
      </li>;
    })}</ol>
  </section>;
}
