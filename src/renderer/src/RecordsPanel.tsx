import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { TerminalSessionView } from "@shared/api-types";
import type { DeliveryRecord } from "@shared/delivery-types";
import type { SessionIndicators } from "@shared/terminal-types";
import type { ActivityEntry } from "./HomeDashboard";
import { errorMessage } from "./ipc-error";
import { holdReasonLabel, memberName } from "./board-model";
import { RecordMessage } from "./RecordMessage";
import { SessionActivityPanel } from "./SessionActivityPanel";
import { useProjectMessages } from "./use-project-messages";

export interface RecordsPanelProps {
  hidden: boolean;
  projectId: string | null;
  projectLabel: string | null;
  sessions: TerminalSessionView[];
  selected: TerminalSessionView | null;
  indicators: Readonly<Record<string, SessionIndicators>>;
  activityLog: ActivityEntry[];
  onFocusSession(session: TerminalSessionView): void;
  onUnreadChange(count: number): void;
  onManageDeliveries(): void;
}

export function RecordsPanel({ hidden, projectId, projectLabel, sessions, selected, indicators, activityLog, onFocusSession, onUnreadChange, onManageDeliveries }: RecordsPanelProps) {
  const messages = useProjectMessages(projectId, hidden, onUnreadChange);
  const [queue, setQueue] = useState<{ projectId: string; records: DeliveryRecord[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [deliveriesOpen, setDeliveriesOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  useEffect(() => { setActivityOpen(false); setDeliveriesOpen(false); }, [projectId]);
  useEffect(() => {
    setQueue(null); setError(null);
    if (hidden || !projectId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const records = await window.multiCliWork.deliveries.list();
        if (!disposed) { setQueue({ projectId, records }); setError(null); }
      } catch (cause) { if (!disposed) { setQueue(null); setError(errorMessage(cause)); } }
      if (!disposed) timer = setTimeout(() => void refresh(), 1000);
    };
    void refresh();
    return () => { disposed = true; clearTimeout(timer); };
  }, [hidden, projectId, retry]);
  const records = queue?.projectId === projectId ? queue.records : null;
  const pending = (records ?? []).filter(record =>
    (record.projectId === undefined ? sessions.find(session => session.id === record.to)?.projectId : record.projectId) === projectId &&
    (record.state === "held" || record.state === "failed"));
  const scopedSelected = selected?.projectId === projectId && projectId !== null ? selected : null;
  return <section hidden={hidden} className="records-panel" aria-label="폴더 기록">
    {!projectId ? <p className="records-empty">폴더를 선택하면 기록을 표시합니다.</p> : <>
      <header className="records-heading"><h2>{projectLabel ?? "현재 폴더"}</h2><span>기록</span></header>
      {error ? <p className="records-error" role="alert">전달 상태를 읽지 못했습니다: {error}<button type="button" onClick={() => setRetry(value => value + 1)}>전달 상태 다시 불러오기</button></p> : null}
      {pending.length > 0 ? <section className="records-deliveries" aria-label="전달 대기 및 실패">
        <button type="button" className="records-disclosure" aria-expanded={deliveriesOpen} onClick={() => setDeliveriesOpen(value => !value)}>
          {deliveriesOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          전달 대기 {pending.filter(record => record.state === "held").length} · 실패 {pending.filter(record => record.state === "failed").length}
        </button>
        {deliveriesOpen ? <><ul>{pending.map(record => {
          const session = sessions.find(candidate => candidate.id === record.to);
          return <li key={record.id}><button type="button" className="record-session-link" disabled={!session} onClick={() => session && onFocusSession(session)}>{session ? memberName(session) : "종료된 세션"}</button>
            <span>{record.state === "held" ? holdReasonLabel(record.reason) : record.reason ?? "전달 실패"}</span><pre>{record.text}</pre></li>;
        })}</ul><button type="button" className="records-manage" onClick={onManageDeliveries}>전달 관리 열기</button></> : null}
      </section> : null}
      {scopedSelected ? <section className="records-activity">
        <button type="button" className="records-disclosure" aria-label={`상세 활동 ${activityOpen ? "접기" : "펼치기"}`} aria-expanded={activityOpen} onClick={() => setActivityOpen(value => !value)}>
          {activityOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}상세 활동<span>{memberName(scopedSelected)}</span>
        </button>
        <SessionActivityPanel hidden={hidden || !activityOpen} sessions={sessions} activity={activityLog} selected={scopedSelected} indicators={indicators} onFocusSession={onFocusSession} />
      </section> : null}
      {messages.error ? <p className="records-error" role="alert">메시지를 읽지 못했습니다: {messages.error}<button type="button" onClick={messages.reload}>메시지 다시 불러오기</button></p> : null}
      {!messages.ready && !messages.error ? <p className="records-empty">메시지 불러오는 중…</p> : null}
      {messages.ready && messages.messages.length === 0 ? <p className="records-empty">아직 메시지가 없습니다.<small>세션 간 메시지와 앱에서 전달한 요청이 여기에 모입니다.</small></p> : null}
      <div className="records-feed">{[...messages.messages].reverse().map(message => <RecordMessage key={message.id} message={message} sessions={sessions} deliveries={records} onFocusSession={onFocusSession} />)}</div>
      <p className="records-footnote">터미널 전달은 작업 완료를 뜻하지 않습니다.</p>
    </>}
  </section>;
}
