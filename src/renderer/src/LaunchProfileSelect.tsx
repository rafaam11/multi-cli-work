import type { LaunchProfile } from "@shared/launch-profile";

export function LaunchProfileSelect({ agentId, profiles, value, onChange, label, disabled }: {
  agentId: string; profiles: LaunchProfile[]; value?: string | null; onChange(value: string | null | undefined): void; label: string; disabled?: boolean;
}) {
  return <select aria-label={label} disabled={disabled} value={value === undefined ? "default" : value === null ? "native" : `profile:${value}`} onChange={event => {
    const selected = event.target.value;
    onChange(selected === "default" ? undefined : selected === "native" ? null : selected.slice(8));
  }}>
    <option value="default">설정의 기본 프로필</option>
    <option value="native">CLI 자체 설정</option>
    {value && !profiles.some(profile => profile.id === value && profile.agentId === agentId) ? <option value={`profile:${value}`}>삭제된 프로필 · 다시 선택 필요</option> : null}
    {profiles.filter(profile => profile.agentId === agentId).map(profile => <option value={`profile:${profile.id}`} key={profile.id}>{profile.name}</option>)}
  </select>;
}
