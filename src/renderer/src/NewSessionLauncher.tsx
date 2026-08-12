import type { AgentId, AgentView } from "@shared/agent-types";
import type { SharedProject } from "@shared/project-types";
import type { SharedWorktree } from "@shared/worktree-types";
import { GitBranch } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import { AgentIcon, agentAccentClass } from "./brand-icons";
import { useClampedMenuPosition } from "./context-menu-position";
import { newSessionLabel, projectName } from "./session-labels";

export interface NewSessionLauncherProps {
  x: number;
  y: number;
  /** Already narrowed to the recent folders — this component does not decide what "recent" is. */
  projects: SharedProject[];
  /** Every worktree the app knows; the rows are filtered by project here. */
  worktrees: SharedWorktree[];
  agents: readonly AgentView[];
  /** Why this folder cannot start anything, or null when it can. */
  disabledReasonFor(projectId: string): string | null;
  onStart(project: SharedProject, agentId: AgentId, worktreeId: string | null): void;
  onClose(): void;
}

/**
 * The list an empty slot opens: the folders worked in most recently, each with the agents that can
 * be started in it. It is the sidebar's 새 세션 block turned inside out — there the folder is known
 * and the agent is picked, here both are, because an empty slot belongs to no folder.
 *
 * A folder's worktrees sit under it as rows of their own rather than behind a submenu. Starting in a
 * branch's checkout is the same kind of move as starting in the main one, and a menu that hid it
 * would make the main checkout look like the only choice.
 */
export function NewSessionLauncher({
  x,
  y,
  projects,
  worktrees,
  agents,
  disabledReasonFor,
  onStart,
  onClose,
}: NewSessionLauncherProps) {
  const menu = useRef<HTMLDivElement>(null);
  const position = useClampedMenuPosition(x, y, menu);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  /**
   * One row's agent buttons. The row says where the session starts and each button says what it
   * starts, so the reason a folder cannot run anything belongs to the whole row while a missing
   * executable belongs to its one button.
   */
  const agentButtons = (project: SharedProject, worktreeId: string | null, where: string) => {
    const reason = disabledReasonFor(project.id);
    return (
      <span className="new-session-row-actions">
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            role="menuitem"
            disabled={reason !== null || !agent.available}
            title={reason ?? (agent.available ? newSessionLabel(agent) : `${agent.label} 실행 파일을 찾을 수 없습니다`)}
            aria-label={`${where}에서 ${agent.label} 시작`}
            onClick={() => {
              onClose();
              onStart(project, agent.id, worktreeId);
            }}
          >
            <AgentIcon agent={agent} size={14} className={agent.available ? agentAccentClass(agent) : undefined} />
          </button>
        ))}
      </span>
    );
  };

  return (
    <div
      className="context-menu new-session-launcher"
      role="menu"
      aria-label="최근 폴더에서 새 세션"
      ref={menu}
      style={{ "--context-menu-x": `${position.x}px`, "--context-menu-y": `${position.y}px` } as CSSProperties}
    >
      <div className="context-menu-label">최근 폴더</div>
      {projects.length === 0 ? (
        <p className="new-session-empty">폴더를 열면 여기에 표시됩니다</p>
      ) : (
        projects.map((project) => {
          const name = projectName(project);
          const branches = worktrees.filter((worktree) => worktree.projectId === project.id);
          return (
            <div key={project.id} className="new-session-group">
              <div className="new-session-row">
                <span className="new-session-row-name" title={project.rootPath}>
                  {name}
                </span>
                {agentButtons(project, null, name)}
              </div>
              {branches.map((worktree) => (
                <div key={worktree.id} className="new-session-row worktree-row">
                  <GitBranch size={12} aria-hidden="true" />
                  <span className="new-session-row-name" title={worktree.path}>
                    {worktree.branch}
                  </span>
                  {agentButtons(project, worktree.id, `${name} · ${worktree.branch}`)}
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}
