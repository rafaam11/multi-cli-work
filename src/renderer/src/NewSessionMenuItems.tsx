import type { AgentId, AgentView } from "@shared/agent-types";
import { AgentIcon } from "./brand-icons";

export interface NewSessionMenuItemsProps {
  /** Every agent the registry knows, in its order — `agents.json` may add its own. */
  agents: readonly AgentView[];
  /** Why the whole block cannot run: a folder whose root went missing, or an action in flight. */
  disabledReason: string | null;
  onStart(agentId: AgentId): void;
}

/**
 * The 새 세션 block the sidebar's folder and worktree menus share. There is no submenu machinery in
 * these menus, so the agents sit flat under a label — the same shape 작업공간에 추가 already uses.
 *
 * The list is never hard-coded: an agent the user added to `agents.json` belongs here as much as
 * PowerShell does, and one whose executable is missing stays visible but says so.
 */
export function NewSessionMenuItems({ agents, disabledReason, onStart }: NewSessionMenuItemsProps) {
  if (agents.length === 0) return null;
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
      <div className="context-menu-separator" role="separator" />
    </>
  );
}
