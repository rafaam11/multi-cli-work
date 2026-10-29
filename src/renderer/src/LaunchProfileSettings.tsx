import { useEffect, useState } from "react";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { CLAUDE_EFFORTS, CODEX_EFFORTS, type LaunchProfile } from "@shared/launch-profile";
import type { WorkbenchSnapshot, WorkbenchState } from "@shared/workbench-types";
import { errorMessage } from "./ipc-error";

export function LaunchProfileSettings() {
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const [draft, setDraft] = useState<LaunchProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void window.multiCliWork.workbench.state().then(value => { if (alive) setSnapshot(value); })
      .catch(cause => { if (alive) setError(errorMessage(cause)); });
    return () => { alive = false; };
  }, []);
  const profiles = snapshot?.state.launchProfiles ?? [];
  const writable = snapshot?.writable === true && !busy;
  const run = async (action: () => Promise<WorkbenchState>, after?: () => void) => {
    setBusy(true); setError(null);
    try {
      const state = await action();
      setSnapshot(current => current ? { ...current, state } : current); after?.();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  };
  return <section className="launch-profile-settings" aria-label="시작 프로필 관리">
    <h2>시작 프로필</h2>
    <p className="settings-hint">새 대화에 사용할 모델과 추론 수준을 저장합니다. 기본 프로필은 다음 새 세션부터 적용되며, 기존 대화 재개·분기는 CLI에 저장된 설정을 따릅니다.</p>
    {snapshot?.warning ? <p className="settings-error" role="alert">{snapshot.warning}</p> : null}
    {error ? <p className="settings-error" role="alert">{error}</p> : null}
    {!snapshot && !error ? <p className="settings-hint">불러오는 중…</p> : null}
    <div className="launch-profile-defaults">{(["codex", "claude"] as const).map(agent => <label key={agent} className="launch-profile-default">
      <span>{agent === "codex" ? "Codex" : "Claude Code"} 기본 프로필</span>
      <select aria-label={`${agent === "codex" ? "Codex" : "Claude Code"} 기본 프로필`} disabled={!writable} value={snapshot?.state.defaultLaunchProfiles?.[agent] ?? ""} onChange={event => void run(() => window.multiCliWork.workbench.setDefaultLaunchProfile(agent, event.target.value || null))}>
        <option value="">CLI 자체 설정</option>
        {profiles.filter(profile => profile.agentId === agent).map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
      </select>
    </label>)}</div>
    <ul className="settings-list launch-profile-list">{profiles.map(profile => <li key={profile.id} className="settings-row">
      <SlidersHorizontal size={16} aria-hidden="true" />
      <span className="settings-list-copy"><strong>{profile.name}</strong><span className="settings-hint">{profile.agentId === "codex" ? "Codex" : "Claude Code"} · {profile.model ?? "CLI 기본 모델"} · {profile.effort ?? "기본 추론"}</span></span>
      <button type="button" disabled={!writable} onClick={() => setDraft({ ...profile })} aria-label={`${profile.name} 편집`}>편집</button>
      <button type="button" disabled={!writable} aria-label={`${profile.name} 삭제`} onClick={() => void run(() => window.multiCliWork.workbench.removeLaunchProfile(profile.id), () => { if (draft?.id === profile.id) setDraft(null); })}><Trash2 size={13} /></button>
    </li>)}</ul>
    {snapshot && !profiles.length ? <p className="settings-hint">프로필을 추가하면 새 세션과 팀 멤버별로 선택할 수 있습니다.</p> : null}
    {draft ? <form className="preset-editor" aria-label="시작 프로필 편집" onSubmit={event => {
      event.preventDefault(); void run(() => window.multiCliWork.workbench.saveLaunchProfile(draft), () => setDraft(null));
    }}>
      <fieldset disabled={!writable} className="launch-profile-fields">
        <label>프로필 이름<input autoFocus maxLength={40} required value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>CLI<select aria-label="CLI" value={draft.agentId} onChange={event => setDraft({ ...draft, agentId: event.target.value as LaunchProfile["agentId"], effort: null, model: null })}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
        <label>모델 ID<input maxLength={200} value={draft.model ?? ""} placeholder="비워 두면 CLI 기본값" onChange={event => setDraft({ ...draft, model: event.target.value || null })} /></label>
        <label>추론 수준<select aria-label="추론 수준" value={draft.effort ?? ""} onChange={event => setDraft({ ...draft, effort: event.target.value || null })}><option value="">CLI 기본값</option>{(draft.agentId === "codex" ? CODEX_EFFORTS : CLAUDE_EFFORTS).map(effort => <option key={effort}>{effort}</option>)}</select></label>
      </fieldset>
      <p className="settings-hint">선택한 모델과 설치된 CLI가 지원하는 수준을 사용하세요. 모델·추론 지원 여부는 실행 시 CLI가 확인합니다.</p>
      <div className="preset-editor-actions"><span /><button type="button" disabled={busy} onClick={() => setDraft(null)}>취소</button><button type="submit" className="primary" disabled={!writable || !draft.name.trim()}>프로필 저장</button></div>
    </form> : <button type="button" disabled={!writable || profiles.length >= 50} onClick={() => setDraft({ id: crypto.randomUUID(), name: "새 프로필", agentId: "codex", model: null, effort: null })}><Plus size={13} /> 새 시작 프로필</button>}
  </section>;
}
