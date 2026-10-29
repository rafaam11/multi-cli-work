import type { AgentView } from "@shared/agent-types";
import {
  PRESET_MEMBER_NAME_MAX,
  PRESET_MEMBERS_MAX,
  PRESET_NAME_MAX,
  PRESET_PROMPT_MAX,
  type SessionPreset,
  type SessionPresetMember,
} from "@shared/preset-types";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AgentIcon } from "./brand-icons";
import { errorMessage } from "./ipc-error";
import type { LaunchProfile } from "@shared/launch-profile";
import { LaunchProfileSelect } from "./LaunchProfileSelect";
import {presetV2Issues} from "@shared/v2-presets";

/**
 * 설정 › 팀 프리셋. A preset is a list of members — which CLI, the pane's name, and the role prompt
 * it is told once it is up. Editing works on a draft; nothing is written until 저장.
 */
export function PresetSettings() {
  const v2=window.mcwV2?.version===2;
  const [presets, setPresets] = useState<SessionPreset[] | null>(null);
  const [agents, setAgents] = useState<AgentView[]>([]);
  const [draft, setDraft] = useState<SessionPreset | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<LaunchProfile[]>([]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve(window.multiCliWork.workbench?.state?.()).then(snapshot => {
      if (alive) setProfiles(snapshot?.state.launchProfiles ?? []);
    }).catch((cause: unknown) => { if (alive) setError(errorMessage(cause)); });
    void Promise.all([window.multiCliWork.presets.list(), window.multiCliWork.agents.list()])
      .then(([loaded, snapshot]) => {
        if (!alive) return;
        setPresets(loaded);
        setAgents(snapshot.agents);
      })
      .catch((cause: unknown) => alive && setError(errorMessage(cause)));
    return () => {
      alive = false;
    };
  }, []);

  const run = (action: () => Promise<SessionPreset[]>, after?: () => void) => {
    setBusy(true);
    setError(null);
    action()
      .then((next) => {
        setPresets(next);
        after?.();
      })
      .catch((cause: unknown) => setError(errorMessage(cause)))
      .finally(() => setBusy(false));
  };

  const eligibleAgents=v2?agents.filter(agent=>["claude","codex"].includes(agent.id)):agents;
  const firstAgent = eligibleAgents.find((agent) => agent.available)?.id ?? eligibleAgents[0]?.id ?? "claude";
  const newPreset = (): SessionPreset => ({
    id: `preset-${Date.now().toString(36)}`,
    name: "새 팀",
    members: [{ agentId: firstAgent, name: "세션 1" }],
  });

  const updateMember = (index: number, patch: Partial<SessionPresetMember>) =>
    setDraft((current) =>
      current ? { ...current, members: current.members.map((member, at) => (at === index ? { ...member, ...patch } : member)) } : current,
    );

  return (
    <>
      <h2>팀 프리셋</h2>
      <p className="settings-hint">
        {v2?"첫 멤버가 대표, 나머지 최대 3명이 작업자가 됩니다. 선택한 프로필로 새 작업을 만들고, 역할 프롬프트를 프로젝트 브리프와 함께 전달합니다. 결과는 사용자가 검토합니다.":"여러 세션을 한 번에 띄우는 묶음입니다. 폴더 우클릭 메뉴, 폴더 시작 화면, 비어 있는 팀 보드에서 시작할 수 있고, 멤버마다 적어 둔 역할 프롬프트는 CLI가 준비되면 자동으로 들어갑니다."}
      </p>
      {presets === null ? (
        <p className="settings-hint">불러오는 중…</p>
      ) : (
        <ul className="settings-list">
          {presets.map((preset) => (
            <li key={preset.id} className="settings-row">
              <span className="settings-list-copy">
                <strong>{preset.name}</strong>
                {v2&&presetV2Issues(preset).map(issue=><small className="settings-hint" key={issue}>{issue}</small>)}
                <span className="preset-settings-members">
                  {preset.members.map((member, index) => (
                    <span key={index}>
                      <AgentIcon agent={agents.find((agent) => agent.id === member.agentId)} size={12} />
                      {member.name}
                    </span>
                  ))}
                </span>
              </span>
              <span className="preset-settings-actions">
                <button type="button" disabled={busy} onClick={() => setDraft(structuredClone(preset))}>
                  편집
                </button>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`${preset.name} 삭제`}
                  onClick={() => run(() => window.multiCliWork.presets.remove(preset.id), () => setDraft(null))}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </li>
          ))}
          {presets.length === 0 ? <li className="settings-hint">프리셋이 없습니다.</li> : null}
        </ul>
      )}
      {draft ? (
        <form
          className="preset-editor"
          aria-label="프리셋 편집"
          onSubmit={(event) => {
            event.preventDefault();
            run(() => window.multiCliWork.presets.save(draft), () => setDraft(null));
          }}
        >
          <label>
            <span>이름</span>
            <input
              type="text"
              value={draft.name}
              maxLength={PRESET_NAME_MAX}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label>
            <span>설명</span>
            <input
              type="text"
              value={draft.description ?? ""}
              maxLength={120}
              placeholder="선택"
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </label>
          {draft.members.map((member, index) => (
            <fieldset key={index} className="preset-editor-member">
              <legend>멤버 {index + 1}</legend>
              <div className="preset-editor-member-row">
                <select
                  aria-label={`멤버 ${index + 1} CLI`}
                  value={member.agentId}
                  onChange={(event) => updateMember(index, { agentId: event.target.value, launchProfileId: undefined })}
                >
                  {agents.filter(agent=>!v2||["claude","codex"].includes(agent.id)||agent.id===member.agentId).map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.label}
                      {agent.available ? "" : " (미설치)"}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  aria-label={`멤버 ${index + 1} 이름`}
                  value={member.name}
                  maxLength={PRESET_MEMBER_NAME_MAX}
                  onChange={(event) => updateMember(index, { name: event.target.value })}
                />
                <button
                  type="button"
                  aria-label={`멤버 ${index + 1} 빼기`}
                  disabled={draft.members.length === 1}
                  onClick={() => setDraft({ ...draft, members: draft.members.filter((_, at) => at !== index) })}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {["codex", "claude"].includes(member.agentId) ? <label className="preset-member-profile"><span>시작 프로필</span><LaunchProfileSelect agentId={member.agentId} profiles={profiles} value={member.launchProfileId} onChange={value => updateMember(index, { launchProfileId: value })} label={`멤버 ${index + 1} 시작 프로필`} /></label> : null}
              <textarea
                aria-label={`멤버 ${index + 1} 역할 프롬프트`}
                placeholder={v2?"역할 프롬프트(선택) — 작업 브리프로 전달됩니다":"역할 프롬프트(선택) — 세션이 준비되면 자동으로 입력됩니다"}
                value={member.prompt ?? ""}
                maxLength={PRESET_PROMPT_MAX}
                rows={4}
                onChange={(event) => updateMember(index, { prompt: event.target.value })}
              />
            </fieldset>
          ))}
          <div className="preset-editor-actions">
            <button
              type="button"
              disabled={draft.members.length >= (v2?4:PRESET_MEMBERS_MAX)}
              onClick={() =>
                setDraft({ ...draft, members: [...draft.members, { agentId: firstAgent, name: `세션 ${draft.members.length + 1}` }] })
              }
            >
              <Plus size={13} /> 멤버 추가
            </button>
            <span />
            <button type="button" onClick={() => setDraft(null)}>
              취소
            </button>
            <button type="submit" className="primary" disabled={busy}>
              저장
            </button>
          </div>
        </form>
      ) : (
        <div className="settings-row">
          <span />
          <button type="button" disabled={busy || presets === null} onClick={() => setDraft(newPreset())}>
            <Plus size={13} /> 새 프리셋
          </button>
        </div>
      )}
      {error ? <p className="settings-error">{error}</p> : null}
    </>
  );
}
