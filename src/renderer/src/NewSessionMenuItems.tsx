import type { AgentId, AgentView } from "@shared/agent-types";
import type { SessionPreset } from "@shared/preset-types";
import { AgentIcon } from "./brand-icons";

export interface NewSessionMenuItemsProps {
  /** Every agent the registry knows, in its order — `agents.json` may add its own. */
  agents: readonly AgentView[];
  /** Why the whole block cannot run: a folder whose root went missing, or an action in flight. */
  disabledReason: string | null;
  onStart(agentId: AgentId): void;
  /** Teams that start in one go; the block lists them under the agents when there are any. */
  presets?: readonly SessionPreset[];
  onStartPreset?(presetId: string): void;
}

/**
 * The 새 세션 block the sidebar's folder and worktree menus share. There is no submenu machinery in
 * these menus, so the agents sit flat under a label rather than behind one more click.
 *
 * The list is never hard-coded: an agent the user added to `agents.json` belongs here as much as
 * PowerShell does, and one whose executable is missing stays visible but says so.
 */
export function NewSessionMenuItems({ agents, disabledReason, onStart, presets = [], onStartPreset }: NewSessionMenuItemsProps) {
  if (agents.length === 0) return null;
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  return (
    <>
      <div className="context-menu-label">새 세션</div>
      {agents.map((agent) => (
        <button
          key={agent.id}
          type="button"
          role="menuitem"
          disabled={disabledReason !== null || !agent.available}
          title={disabledReason ?? (agent.available ? undefined : `${agent.label} 실행 파일을 찾을 수 없습니다`)}
          onClick={() => onStart(agent.id)}
        >
          <AgentIcon agent={agent} size={15} />
          <span>{agent.label}</span>
        </button>
      ))}
      {onStartPreset && presets.length > 0 ? (
        <>
          <div className="context-menu-label">프리셋으로 시작</div>
          {presets.map((preset) => {
            const missing = preset.members.find((member) => !byId.get(member.agentId)?.available);
            return (
              <button
                key={preset.id}
                type="button"
                role="menuitem"
                className="preset-menu-item"
                disabled={disabledReason !== null || missing !== undefined}
                title={
                  disabledReason ??
                  (missing
                    ? `${byId.get(missing.agentId)?.label ?? missing.agentId} 실행 파일을 찾을 수 없습니다`
                    : preset.members.map((member) => member.name).join(", "))
                }
                onClick={() => onStartPreset(preset.id)}
              >
                <span className="preset-menu-icons" aria-hidden="true">
                  {preset.members.map((member, index) => (
                    <AgentIcon key={index} agent={byId.get(member.agentId)} size={13} />
                  ))}
                </span>
                <span>{preset.name}</span>
              </button>
            );
          })}
        </>
      ) : null}
      <div className="context-menu-separator" role="separator" />
    </>
  );
}
