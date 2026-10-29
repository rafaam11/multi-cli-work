import { useEffect, useRef, useState } from "react";
import type { Task, TaskAgentChoice, TaskProvider } from "@shared/host-types";
import type { McwV2Api, V2HostState } from "@shared/v2-api";
import type { LaunchProfile } from "@shared/launch-profile";
import "./task-panel.css";
import { errorMessage } from "../ipc-error";

export interface TaskPanelProps {
  projectId?: string;
  hostId?: string;
  hostName?: string;
  defaultCwd?: string;
  api?: McwV2Api;
  onTaskStarted?(taskId: string, result: unknown): void;
  onOpenTerminal?(sessionId: string): void;
}
type Configuration = Awaited<ReturnType<McwV2Api["configuration"]>>;
const executionLabel = { not_started: "시작 전", running: "실행 중", idle: "입력 대기", exited: "프로세스 종료", lost: "관찰 연결 끊김" };
const deliveryLabel = { none: "전달 전", pending: "전달 중", delivered: "전달됨", unknown: "전달 여부 불명", rejected: "전달 거부" };
const providerName = (provider: TaskProvider) => provider === "codex" ? "Codex" : "Claude Code";
const message = errorMessage;

function AgentFields({ label, value, profiles, disabled, onChange, onRemove }: {
  label: string; value: TaskAgentChoice; profiles: LaunchProfile[]; disabled: boolean;
  onChange(value: TaskAgentChoice): void; onRemove?(): void;
}) {
  return <fieldset className="herdr-task-agent" disabled={disabled}>
    <legend>{label}</legend>
    <label><span>도구</span><select aria-label={`${label} 도구`} value={value.provider} onChange={(event) => onChange({ ...value, provider: event.currentTarget.value as TaskProvider, profileId: "" })}>
      <option value="codex">Codex</option><option value="claude">Claude Code</option>
    </select></label>
    <label><span>시작 프로필</span><select aria-label={`${label} 시작 프로필`} value={value.profileId} onChange={(event) => onChange({ ...value, profileId: event.currentTarget.value })}>
      {!value.profileId && <option value="">프로필 선택</option>}
      {profiles.filter((profile) => profile.agentId === value.provider).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.model ? ` · ${profile.model}` : ""}{profile.effort ? ` / ${profile.effort}` : ""}</option>)}
    </select></label>
    <span className="herdr-task-hint">{label === "대표" ? "이 PC에서 작업을 소유합니다." : "대표와 같은 PC"}</span>
    {onRemove && <button type="button" onClick={onRemove} aria-label={`${label} 제거`}>제거</button>}
  </fieldset>;
}

export function TaskPanel({ projectId, hostId,hostName,defaultCwd = "", api = window.mcwV2, onTaskStarted, onOpenTerminal }: TaskPanelProps) {
  const [configuration, setConfiguration] = useState<Configuration | null>(null), [tasks, setTasks] = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null), [title, setTitle] = useState(""), [brief, setBrief] = useState("");
  const [lead, setLead] = useState<TaskAgentChoice>({ provider: "codex", profileId: "" }), [workers, setWorkers] = useState<TaskAgentChoice[]>([]);
  const [loading, setLoading] = useState(true), [pending, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [hostState, setHostState] = useState<V2HostState | null>(null);
  const offline = hostState?.connected === false || (!!hostId&&hostState===null), busy = pending || offline;
  const [repositoryPath, setRepositoryPath] = useState(defaultCwd), [expectedHead, setExpectedHead] = useState<string | null>(null);
  const [answers,setAnswers]=useState<Record<string,string>>({}),[userMessage,setUserMessage]=useState("");
  const stateRevision=useRef(0);
  const sourceConnected=useRef<boolean|null>(null);
  const alive = useRef(true), checkedPath = useRef<string | null>(null);
  const defaultProfile = (provider: TaskProvider, config = configuration) => config?.defaultLaunchProfiles[provider]
    ?? config?.launchProfiles.find((profile) => profile.agentId === provider)?.id ?? "";
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  const visibleTasks = tasks.filter((task) => projectId === undefined || task.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt);
  const listTasks=()=>hostId?api!.listTasks(hostId):api!.listTasks();

  useEffect(() => {
    alive.current = true;
    setLoading(true); setError(null);
    if (!api) { setLoading(false); return; }
    const initialRevision=stateRevision.current;
    const received = (state:V2HostState) => {
      stateRevision.current++;if(!alive.current)return;
      const remote=hostId?state.hosts?.find(host=>host.hostId===hostId):undefined;
      const scoped=hostId?{...state,tasks:remote?.tasks??[],terminals:remote?.terminals??[],connected:state.connected&&remote?.enabled===true&&remote.connected,observedAt:remote?.observedAt??null}:state;
      sourceConnected.current=scoped.connected;setHostState(scoped);setTasks(scoped.tasks);
    };
    const unsubscribe=api.onState?.(received);
    void Promise.all([api.configuration(),api.hostState?.().catch(()=>null)??Promise.resolve(null)]).then(async([config,snapshot]) => {
      if (!alive.current) return;
      if(snapshot&&stateRevision.current===initialRevision)received(snapshot);
      setConfiguration(config);
      setLead((current) => ({ ...current, profileId: current.profileId || defaultProfile(current.provider, config) }));
      if(hostId&&sourceConnected.current!==true)return;
      const revision=stateRevision.current,entries=await listTasks();
      if(alive.current&&stateRevision.current===revision)setTasks(entries);
    }).catch((cause) => { if (alive.current) setError(message(cause)); }).finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; unsubscribe?.(); };
  }, [api,hostId]);
  useEffect(() => { setRepositoryPath(defaultCwd); setExpectedHead(null); checkedPath.current = null; }, [selectedId, defaultCwd]);

  const run = async (action: () => Promise<void>) => {
    if (offline) return;
    setBusy(true); setError(null);
    try { await action(); } catch (cause) { if (alive.current) setError(message(cause)); }
    finally { if (alive.current) setBusy(false); }
  };
  const refresh = () => { if (api) void run(async () => { const entries = await listTasks(); if (alive.current) setTasks(entries); }); };
  const act = (action:Parameters<McwV2Api["taskAction"]>[1],input:Record<string,unknown>) => {
    if(!api||!selected)return;const taskId=selected.id;
    void run(async()=>{
      if(hostId)await api.taskAction(taskId,action,input,hostId);else await api.taskAction(taskId,action,input);
      const updated=hostId?await api.inspectTask(taskId,hostId):await api.inspectTask(taskId);
      if(alive.current)setTasks(current=>current.map(task=>task.id===taskId?updated:task));
    });
  };
  const openTerminal=(sessionId:string,ownerHostId:string)=>{
    if(!api)return;
    void run(async()=>{
      if(ownerHostId===configuration?.hostId){onOpenTerminal?.(sessionId);return;}
      if(!api.terminalViewId)throw new Error("원격 터미널 관찰 연결이 준비되지 않았습니다.");
      const viewId=await api.terminalViewId(sessionId,ownerHostId);if(alive.current)onOpenTerminal?.(viewId);
    });
  };
  const changeChoice = (value: TaskAgentChoice): TaskAgentChoice => ({ ...value, profileId: value.profileId || defaultProfile(value.provider) });
  const create = () => {
    if (!api || !configuration || hostId) return;
    void run(async () => {
      const created = await api.createTask({ title: title.trim(), brief: brief.trim(), ...(projectId === undefined ? {} : { projectId }),
        lead: { ...lead, hostId: configuration.hostId }, workers });
      if (!alive.current) return;
      setTasks((current) => [...current.filter((task) => task.id !== created.id), created]);
      setSelectedId(created.id); setTitle(""); setBrief("");
    });
  };
  const start = () => {
    if (!api || !selected || !expectedHead || hostId || checkedPath.current !== repositoryPath) return;
    const taskId = selected.id, path = repositoryPath, head = expectedHead;
    void run(async () => {
      const result = await api.startTask(taskId, { repositoryPath: path, expectedHead: head });
      if (!alive.current) return;
      setExpectedHead(null); checkedPath.current = null;
      onTaskStarted?.(taskId, result);
      if (result && typeof result === "object" && "sessionId" in result && typeof result.sessionId === "string") onOpenTerminal?.(result.sessionId);
      const entries = await api.listTasks(); if (alive.current) setTasks(entries);
    });
  };
  const profilesValid = !!configuration && [lead, ...workers].every((choice) => configuration.launchProfiles.some((profile) => profile.id === choice.profileId && profile.agentId === choice.provider));
  const startable = !hostId && selected?.cancellation === "none" && selected.participants.every((participant) => participant.attempt.delivery === "none" && participant.attempt.execution === "not_started");

  if (!api) return <section className="herdr-task-panel"><p role="status">v2 호스트 연결이 준비되지 않았습니다.</p></section>;
  return <section className="herdr-task-panel" aria-label="협업 작업">
    <header className="herdr-task-header"><div><h2>{hostId?`${hostName??hostId} 작업·결과`:"협업 작업"}</h2><p>{hostId?"작업을 소유한 PC에 메시지와 확인 결과를 전달합니다.":"작업마다 새 대표가 지시를 받고, 선택한 작업자가 결과를 제출합니다."}</p></div><button type="button" disabled={busy || loading} onClick={refresh}>새로고침</button></header>
    {error && <p className="herdr-task-error" role="alert">{error}</p>}
    {offline && <p role="status">호스트 연결 끊김 · 마지막 수신: {hostState?.observedAt == null ? "없음" : new Date(hostState.observedAt).toLocaleString()}. 아래 상태는 마지막 관찰입니다.</p>}
    {loading && <p role="status">호스트 작업을 불러오는 중…</p>}
    {!hostId&&<form className="herdr-task-create" onSubmit={(event) => { event.preventDefault(); create(); }}>
      <label><span>작업 제목</span><input aria-label="작업 제목" value={title} maxLength={200} required disabled={busy} onChange={(event) => setTitle(event.currentTarget.value)} /></label>
      <label><span>작업 지시</span><textarea aria-label="작업 지시" value={brief} maxLength={20000} required rows={3} disabled={busy} onChange={(event) => setBrief(event.currentTarget.value)} /></label>
      <div className="herdr-task-agents">
        <AgentFields label="대표" value={lead} profiles={configuration?.launchProfiles ?? []} disabled={busy || !configuration} onChange={(value) => setLead(changeChoice(value))} />
        {workers.map((worker, index) => <AgentFields key={index} label={`작업자 ${index + 1}`} value={worker} profiles={configuration?.launchProfiles ?? []} disabled={busy}
          onChange={(value) => setWorkers((current) => current.map((choice, i) => i === index ? changeChoice(value) : choice))} onRemove={() => setWorkers((current) => current.filter((_, i) => i !== index))} />)}
      </div>
      <div className="herdr-task-form-actions"><button type="button" disabled={busy || !configuration || workers.length >= 3} onClick={() => setWorkers((current) => [...current, { provider: "codex", profileId: defaultProfile("codex") }])}>작업자 추가</button>
        <span className="herdr-task-hint">최대 3명 · 생성 후 저장소와 기준 커밋을 확인하고 시작합니다.</span>
        <button type="submit" disabled={busy || !profilesValid || !title.trim() || !brief.trim()}>작업 만들기</button></div>
    </form>}
    <div className="herdr-task-workspace">
      <nav className="herdr-task-list" aria-label="작업 목록">{visibleTasks.length === 0 && !loading ? <p className="herdr-task-hint">아직 작업이 없습니다.</p> : visibleTasks.map((task) => <button type="button" key={task.id} aria-pressed={task.id === selectedId} onClick={() => setSelectedId(task.id)}>
        <strong>{task.title}</strong><span>{task.attention.status === "waiting" ? task.attention.kind === "approval" ? "승인 대기" : "질문 대기" : task.results.length ? "결과 제출됨" : executionLabel[task.participants.find((p) => p.role === "lead")?.attempt.execution ?? "not_started"]}</span>
      </button>)}</nav>
      {selected && <article className="herdr-task-detail" aria-label="선택한 작업">
        <h3>{selected.title}</h3><p className="herdr-task-brief">{selected.brief}</p>
        <table><thead><tr><th>역할 · 도구</th><th>실행 관찰</th><th>명령 전달</th><th>마지막 관찰</th></tr></thead><tbody>{selected.participants.map((participant) => <tr key={participant.id}>
          <td>{participant.role === "lead" ? "대표" : "작업자"} · {providerName(participant.provider)}<small>{(!hostId&&configuration?.launchProfiles.find((profile) => profile.id === participant.profileId)?.name) || participant.profileId} · {participant.hostId === configuration?.hostId ? "이 PC" : participant.hostId===hostId?hostName??hostId:participant.hostId}</small>{participant.attempt.delivery === "delivered" && participant.attempt.execution !== "exited" && <button type="button" disabled={busy} onClick={() => openTerminal(participant.attempt.id,participant.hostId)}>터미널 열기</button>}</td>
          <td>{executionLabel[participant.attempt.execution]}</td><td>{deliveryLabel[participant.attempt.delivery]}</td><td>{participant.attempt.observedAt === null ? "관찰 없음" : new Date(participant.attempt.observedAt).toLocaleString()}</td>
        </tr>)}</tbody></table>
        {startable && <div className="herdr-task-start"><label><span>저장소 경로</span><input aria-label="저장소 경로" value={repositoryPath} disabled={busy} onChange={(event) => { setRepositoryPath(event.currentTarget.value); setExpectedHead(null); checkedPath.current = null; }} /></label>
          <button type="button" disabled={busy || !repositoryPath.trim()} onClick={() => {
            const path = repositoryPath;
            void run(async () => { const head = await api.repositoryHead(path); if (alive.current) { checkedPath.current = path; setExpectedHead(head); } });
          }}>기준 커밋 확인</button>
          {expectedHead && <code title={expectedHead}>{expectedHead.slice(0, 12)}</code>}
          <button type="button" disabled={busy || !expectedHead || checkedPath.current !== repositoryPath} onClick={start}>작업 시작</button>
        </div>}
        {selected.questions.filter((question) => question.answer === null).map((question) => <div className="herdr-task-question" key={question.id}>
          <strong>{question.kind === "approval" ? "승인 대기" : "질문 대기"} · {question.acknowledged ? "확인한 요청" : "미확인 요청"}</strong><p>{question.text}</p>
          {!question.acknowledged&&<button type="button" disabled={busy} onClick={()=>act("acknowledge",{eventId:question.id})}>요청 확인</button>}
          <label><span>답변</span><input aria-label={`답변: ${question.text}`} value={answers[question.id]??""} maxLength={20000} disabled={busy} onChange={event=>{const text=event.currentTarget.value;setAnswers(current=>({...current,[question.id]:text}));}} /></label>
          <button type="button" disabled={busy||!answers[question.id]?.trim()} onClick={()=>act("answer",{eventId:question.id,text:answers[question.id].trim()})}>답변 보내기</button>
        </div>)}
        {selected.results.length > 0 && <section aria-label="제출 결과"><h4>제출 결과</h4>{selected.results.map((result) => <div className="herdr-task-result" key={result.id}>
          <strong>{result.summary}</strong><span className="herdr-task-hint">미통합 · {result.review === "pending" ? "사용자 확인 대기" : "사용자 확인됨"}</span>
          {result.review==="pending"&&<button type="button" disabled={busy} onClick={()=>act("acknowledge-result",{resultId:result.id})}>결과 확인</button>}
          {([ ["변경", result.changes], ["검증", result.verification], ["산출물", result.artifacts], ["남은 문제", result.issues] ] as const).map(([label, lines]) => lines.length > 0 && <div key={label}><h5>{label}</h5><ul>{lines.map((line, i) => <li key={i}>{line}</li>)}</ul></div>)}
        </div>)}</section>}
        {selected.events.length > 0 && <section aria-label="작업 메시지"><h4>메시지와 기록</h4><ol className="herdr-task-events">{selected.events.map((event) => <li key={event.id}><time>{new Date(event.at).toLocaleTimeString()}</time><span>{event.text}</span></li>)}</ol></section>}
        <form onSubmit={event=>{event.preventDefault();act("message",{text:userMessage.trim()});}}><label><span>팀 메시지</span><textarea aria-label="팀 메시지" value={userMessage} disabled={busy} maxLength={20000} onChange={event=>setUserMessage(event.currentTarget.value)} /></label><button disabled={busy||!userMessage.trim()} type="submit">메시지 보내기</button></form>
        <button type="button" disabled={busy||selected.cancellation!=="none"} onClick={()=>act("cancel",{})}>{selected.cancellation==="none"?"작업 취소 요청":"취소 요청됨"}</button>
      </article>}
    </div>
  </section>;
}
