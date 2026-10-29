import { useEffect, useState } from "react";
import type { ProviderActivity } from "@shared/activity-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { SessionIndicators } from "@shared/terminal-types";
import type { ActivityEntry } from "./HomeDashboard";
import { statusLabels } from "./session-labels";
import { SessionChips } from "./SessionChips";

const EVENT_LABELS: Record<string, string> = {
  SessionStart: "세션 시작", SessionEnd: "세션 종료", UserPromptSubmit: "요청 제출",
  PreToolUse: "도구 시작", PostToolUse: "도구 종료", PostToolUseFailure: "도구 실패",
  PermissionRequest: "승인 요청", Stop: "응답 종료", StopFailure: "응답 오류", Interrupt: "중단",
  Notification: "CLI 알림", SubagentStart: "하위 에이전트 시작", SubagentStop: "하위 에이전트 종료",
  PreCompact: "압축 시작", PostCompact: "압축 종료", PostModelSwitch: "모델 적용", TaskCreated: "작업 생성", TaskCompleted: "작업 완료",
};

export function SessionActivityPanel({ hidden, sessions, activity, selected, indicators, onFocusSession }: {
  hidden: boolean; sessions: TerminalSessionView[]; activity: ActivityEntry[];
  selected: TerminalSessionView | null; indicators: Readonly<Record<string, SessionIndicators>>;
  onFocusSession(session: TerminalSessionView): void;
}) {
  const [onlySelected, setOnlySelected] = useState(false);
  const [providerEvents, setProviderEvents] = useState<ProviderActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  useEffect(() => {
    setParentId(null);
    if (hidden || !selected || !window.multiCliWork.workbench) return;
    let disposed = false;
    void Promise.resolve(window.multiCliWork.workbench.state()).then(snapshot => {
      if (!disposed) setParentId(snapshot?.state.forks?.[selected.id] ?? null);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, [hidden, selected?.id]);
  useEffect(() => {
    if (hidden || !window.multiCliWork.activity) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const events = await window.multiCliWork.activity.list(); if (!disposed) { setProviderEvents(events); setError(null); } }
      catch (cause) { if (!disposed) setError(String(cause)); }
      if (!disposed) timer = setTimeout(() => void refresh(), 1000);
    };
    void refresh(); return () => { disposed = true; clearTimeout(timer); };
  }, [hidden]);
  if (hidden) return null;
  const entries = onlySelected ? activity.filter(entry => entry.sessionId === selected?.id) : activity;
  const observed = providerEvents.filter(event => !onlySelected || event.sessionId === selected?.id);
  const selectedEvents = providerEvents.filter(event => event.sessionId === selected?.id);
  const lastGeneration = selectedEvents.at(-1)?.generation;
  const generationEvents = selectedEvents.filter(event => event.generation === lastGeneration);
  let lastRootStart = -1;
  generationEvents.forEach((event, index) => { if (event.event === "SessionStart" && !event.agentId) lastRootStart = index; });
  const currentEvents = generationEvents.slice(Math.max(0, lastRootStart));
  const agents = new Map<string, ProviderActivity>();
  const tasks = new Map<string, ProviderActivity>();
  for (const event of currentEvents) {
    if (event.agentId && ["SubagentStart", "SubagentStop"].includes(event.event)) agents.set(event.agentId, event);
    if (event.taskId) tasks.set(event.taskId, event);
  }
  return <section hidden={hidden} className="delivery-panel session-activity-panel" aria-label="세션 활동 및 정보">
    <header><h2>세션 관측</h2><p>이 창에서 관측한 상태 전환입니다. 응답 종료는 작업 성공을 의미하지 않습니다.</p></header>
    {error ? <p role="alert">{error}</p> : null}
    {selected ? <section className="delivery-card" aria-label="선택 세션 정보">
      <h3>{selected.name || selected.title || selected.kind}</h3>
      {parentId ? <button type="button" disabled={!sessions.some(session => session.id === parentId)} onClick={() => { const parent = sessions.find(session => session.id === parentId); if (parent) onFocusSession(parent); }}>원본 대화로 이동</button> : null}
      <SessionChips chips={indicators[selected.id]?.chips ?? []} />
      <dl><dt>상태</dt><dd>{statusLabels[selected.status]}</dd><dt>CLI</dt><dd>{selected.kind}</dd>
        <dt>작업 위치</dt><dd>{selected.cwd}</dd><dt>마지막 상태 갱신</dt><dd>{new Date(selected.updatedAt).toLocaleString()}</dd>
        <dt>대화 ID</dt><dd>{selected.providerConversationId || "아직 확인되지 않음"}</dd></dl>
    </section> : <p>세션을 선택하면 상세 정보를 표시합니다.</p>}
    {agents.size ? <section className="delivery-card"><h3>관측된 하위 에이전트</h3><ul>{[...agents.values()].map(event => <li key={event.agentId}>{event.agentType || event.agentId} · {event.event === "SubagentStop" ? "종료 관측" : "시작 관측"}</li>)}</ul></section> : null}
    {tasks.size ? <section className="delivery-card"><h3>관측된 작업</h3><ul>{[...tasks.values()].map(event => <li key={event.taskId}>{event.taskSubject || event.taskId} · {event.event === "TaskCompleted" ? "완료 관측" : "생성 관측"}</li>)}</ul></section> : null}
    <label className="activity-filter"><input type="checkbox" checked={onlySelected} onChange={event => setOnlySelected(event.target.checked)} />선택 세션만 보기</label>
    <h3>CLI 활동 이력</h3><p>최근 7일, 최대 500건의 관측 기록입니다. 마지막 기록이 현재 상태와 다를 수 있습니다.</p>
    <ol className="activity-timeline">{[...observed].reverse().map(event => {
      const session = sessions.find(candidate => candidate.id === event.sessionId);
      return <li key={event.id} className={event.event.includes("Failure") ? "status-error" : ""}>
        <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
        <button type="button" disabled={!session} onClick={() => session && onFocusSession(session)}>{session?.name || session?.title || event.provider}</button>
        <span>{EVENT_LABELS[event.event] ?? event.event}{event.toolName ? ` · ${event.toolName}` : ""}{event.agentType ? ` · ${event.agentType}` : ""}{event.model ? ` · ${event.model}` : ""}{event.agentId ? ` · agent ${event.agentId}` : ""}</span>
      </li>;
    })}</ol>
    <h3>이 창의 상태 전환</h3>
    {entries.length === 0 ? <p>관측된 상태 전환이 없습니다.</p> : null}
    <ol className="activity-timeline">{entries.map(entry => {
      const session = sessions.find(candidate => candidate.id === entry.sessionId);
      return <li key={entry.id} className={`status-${entry.toStatus}`}>
        <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleTimeString()}</time>
        <button type="button" disabled={!session} onClick={() => session && onFocusSession(session)}>{entry.sessionLabel}</button>
        <span>{statusLabels[entry.fromStatus]} → {statusLabels[entry.toStatus]}</span>
      </li>;
    })}</ol>
  </section>;
}
