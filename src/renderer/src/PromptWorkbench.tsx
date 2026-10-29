import { useEffect, useState } from "react";
import type { TerminalSessionView } from "@shared/api-types";
import type { PromptEntry, WorkbenchSnapshot, WorkbenchState } from "@shared/workbench-types";

const COMMANDS: Record<string, { command: string; label: string }[]> = {
  codex: [{ command: "/config", label: "설정" }, { command: "/model", label: "모델·추론" }, { command: "/permissions", label: "권한" }, { command: "/presets", label: "프리셋" }],
  claude: [{ command: "/rewind", label: "되감기" }, { command: "/compact", label: "대화 압축" }, { command: "/model", label: "모델" }, { command: "/effort", label: "추론 수준" }],
};
export function PromptWorkbench({ hidden, sessions, onFocusSession }: {
  hidden: boolean; sessions: TerminalSessionView[]; onFocusSession(session: TerminalSessionView): void;
}) {
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState("");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [agentId, setAgentId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (hidden) return;
    let disposed = false;
    void window.multiCliWork.workbench.state().then(value => { if (!disposed) setSnapshot(value); })
      .catch(cause => { if (!disposed) setError(String(cause)); });
    return () => { disposed = true; };
  }, [hidden]);
  const update = (state: WorkbenchState) => setSnapshot(current => current ? { ...current, state } : current);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  };
  const selected = sessions.find(session => session.id === target);
  const writable = snapshot?.writable === true && !busy;
  const prompts = (snapshot?.state.prompts ?? []).filter(prompt =>
    (!prompt.agentId || !selected || prompt.agentId === selected.kind) &&
    `${prompt.name} ${prompt.tags.join(" ")}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
  const load = (prompt: PromptEntry) => { setEditingId(prompt.id); setName(prompt.name); setTags(prompt.tags.join(", ")); setText(prompt.text); setAgentId(prompt.agentId ?? ""); };
  return <section hidden={hidden} className="prompt-workbench delivery-panel" aria-label="프롬프트 라이브러리">
    <header><h2>프롬프트 라이브러리</h2><p>초안을 작성하고 대상 세션의 준비 상태에 맞춰 전달합니다.</p></header>
    {snapshot?.warning ? <p role="alert">{snapshot.warning}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    <label>대상 세션<select value={target} disabled={busy} onChange={event => {
      const id = event.target.value; setTarget(id); setText(snapshot?.state.drafts[id] ?? ""); setEditingId(null); setName(""); setTags(""); setAgentId("");
    }}><option value="">대상 선택</option>{sessions.filter(session => session.pid !== null && session.status !== "exited" && session.status !== "error").map(session =>
      <option value={session.id} key={session.id}>{session.kind} · {session.name || session.title || session.id.slice(0, 8)}</option>)}</select></label>
    <label>라이브러리 검색<input value={query} onChange={event => setQuery(event.target.value)} placeholder="이름·태그 검색" /></label>
    <details><summary>라이브러리 가져오기·내보내기</summary>
      <p>이름과 내용이 같은 항목은 건너뛰고 새 항목을 추가합니다. 초안은 내보내지 않습니다.</p>
      <label>JSON 라이브러리 추가<input type="file" accept=".json,application/json" disabled={!writable} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (!file) return;
        void perform(async () => {
          if (file.size > 1_000_000) throw new Error("파일은 1MB 이하이어야 합니다.");
          update(await window.multiCliWork.workbench.importPrompts(await file.text())); setNotice("라이브러리를 가져왔습니다.");
        });
      }} /></label>
      <button type="button" disabled={busy || !snapshot || Boolean(snapshot.warning)} onClick={() => void perform(async () => {
        const file = await window.multiCliWork.workbench.exportPrompts(); if (file) setNotice("라이브러리를 내보냈습니다.");
      })}>라이브러리 내보내기</button>
    </details>
    <ul className="prompt-library-list">{prompts.map(prompt => <li key={prompt.id}>
      <button type="button" disabled={busy} onClick={() => load(prompt)}>{prompt.name}<small>{prompt.tags.join(" · ")}</small></button>
      <button type="button" disabled={!writable} aria-label={`${prompt.name} 즐겨찾기`} aria-pressed={prompt.favorite} onClick={() => void perform(async () => update(await window.multiCliWork.workbench.savePrompt({ ...prompt, favorite: !prompt.favorite })))}>{prompt.favorite ? "★" : "☆"}</button>
      <button type="button" disabled={!writable} aria-label={`${prompt.name} 삭제`} onClick={() => void perform(async () => update(await window.multiCliWork.workbench.removePrompt(prompt.id)))}>삭제</button>
    </li>)}</ul>
    <label>프롬프트<textarea disabled={busy} value={text} maxLength={8000} onChange={event => setText(event.target.value)} placeholder="요청 또는 인계할 내용을 작성하세요" /></label>
    <div className="delivery-actions">
      <button type="button" disabled={!writable || !target} onClick={() => void perform(async () => { update(await window.multiCliWork.workbench.saveDraft(target, text)); setNotice("초안을 저장했습니다."); })}>초안 저장</button>
      <button type="button" disabled={busy || !text} onClick={() => void perform(async () => { await window.multiCliWork.clipboard.writeText(text); setNotice("복사했습니다."); })}>복사</button>
      <button type="button" disabled={busy || !selected || !text.trim()} onClick={() => void perform(async () => {
        if (!selected) return;
        const result = await window.multiCliWork.deliveries.send(selected.id, text);
        setNotice(result.recordingWarning ?? "전달 큐에 등록했습니다. 기록 탭에서 상태를 확인할 수 있습니다.");
        // Keep the draft until the user explicitly clears it: enqueueing is not execution acknowledgement.
      })}>보류 큐로 전송</button>
    </div>
    <details><summary>라이브러리에 저장</summary>
      <label>이름<input disabled={busy} maxLength={40} value={name} onChange={event => setName(event.target.value)} /></label>
      <label>태그 (쉼표로 구분)<input disabled={busy} value={tags} onChange={event => setTags(event.target.value)} /></label>
      <label>CLI 범위<select disabled={busy} value={agentId} onChange={event => setAgentId(event.target.value)}><option value="">공통</option><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
      <button type="button" disabled={!writable || !name.trim() || !text.trim()} onClick={() => void perform(async () => {
        const id = editingId ?? crypto.randomUUID();
        update(await window.multiCliWork.workbench.savePrompt({ id, name: name.trim(), text, tags: tags.split(",").map(tag => tag.trim()).filter(Boolean), favorite: snapshot?.state.prompts.find(prompt => prompt.id === id)?.favorite ?? false, agentId: agentId || null }));
        setEditingId(id); setNotice("프롬프트를 저장했습니다.");
      })}>{editingId ? "프롬프트 수정 저장" : "새 프롬프트 저장"}</button>
      <button type="button" disabled={busy} onClick={() => { setEditingId(null); setName(""); setTags(""); }}>새 항목으로 작성</button>
    </details>
    {selected && COMMANDS[selected.kind] ? <details><summary>{selected.kind === "codex" ? "Codex" : "Claude Code"} 명령 도우미</summary><p>명령을 복사한 뒤 터미널에서 실행합니다. 설치된 CLI의 지원 여부는 /help에서 확인하세요.</p><div className="delivery-actions">{COMMANDS[selected.kind].map(item =>
      <button key={item.command} type="button" disabled={busy} title={item.command} onClick={() => void perform(async () => { await window.multiCliWork.clipboard.writeText(item.command); onFocusSession(selected); setNotice(`${item.command} 복사됨`); })}>{item.label}</button>)}</div></details> : null}
  </section>;
}
