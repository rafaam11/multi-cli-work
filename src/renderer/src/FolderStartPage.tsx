import type { AgentView } from "@shared/agent-types";
import type { GitStatusResult } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalKind } from "@shared/terminal-types";
import type { SharedWorktree } from "@shared/worktree-types";
import { FolderOpen, GitBranch, PanelsTopLeft, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AgentIcon, GitHubIcon, VSCodeIcon, agentAccentClass } from "./brand-icons";
import { newSessionLabel, projectName } from "./session-labels";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface FolderStartPageProps {
  project: SharedProject;
  /** When set, the surface is a worktree of `project`: its branch, its directory, its git state. */
  worktree: SharedWorktree | null;
  /** Every worktree of this project, so the list can offer the siblings of whatever is on screen. */
  worktrees: SharedWorktree[];
  agents: AgentView[];
  vscodeAvailable: boolean;
  pendingAction: boolean;
  /** The folder's root is gone from disk — nothing here can start until it is relinked. */
  projectMissing: boolean;
  /**
   * The arrangement the header's picker is set to. Choosing one here changes nothing on screen —
   * there is no grid yet — so the page says out loud what the first session will open into.
   */
  layoutLabel: string;
  onStartSession(kind: TerminalKind): void;
  onSelectWorktree(worktree: SharedWorktree): void;
  onCreateWorktree(): void;
  onOpenDetail(): void;
  onReveal(): void;
  onOpenInEditor(): void;
  onOpenOnGitHub(): void;
}

/**
 * What a folder shows before it has a single session. The old empty state was an icon and one line
 * of advice, which left the largest area on screen saying nothing about the folder the user just
 * opened — so this page answers both questions at once: start what, and what is this folder doing.
 *
 * It is deliberately not the 상세 page in disguise. Memo and checklists stay there; what lands here
 * is only what bears on starting work right now — the launchers, the branch, the sibling worktrees,
 * and the ways out of the app.
 */
export function FolderStartPage({
  project,
  worktree,
  worktrees,
  agents,
  vscodeAvailable,
  pendingAction,
  projectMissing,
  layoutLabel,
  onStartSession,
  onSelectWorktree,
  onCreateWorktree,
  onOpenDetail,
  onReveal,
  onOpenInEditor,
  onOpenOnGitHub,
}: FolderStartPageProps) {
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
  const [gitStatusLoading, setGitStatusLoading] = useState(false);
  const [gitStatusError, setGitStatusError] = useState<string | null>(null);

  const loadGitStatus = useCallback(() => {
    setGitStatusLoading(true);
    setGitStatusError(null);
    (worktree
      ? window.multiCliWork.worktrees.gitStatus(worktree.id)
      : window.multiCliWork.projects.gitStatus(project.id))
      .then(setGitStatus)
      .catch((error) => setGitStatusError(errorMessage(error)))
      .finally(() => setGitStatusLoading(false));
  }, [project.id, worktree]);

  useEffect(() => {
    loadGitStatus();
  }, [loadGitStatus]);

  const name = worktree ? `${projectName(project)} · ${worktree.branch}` : projectName(project);
  const rootPath = worktree ? worktree.path : project.rootPath;
  const canLaunch = !projectMissing && !pendingAction;

  return (
    <section className="folder-start" aria-label={`${name} 시작`}>
      <div className="folder-start-hero">
        <h2>{name}에서 시작</h2>
        <p className="folder-start-path" title={rootPath}>
          {rootPath}
        </p>
        {projectMissing ? (
          <p className="folder-start-warning">
            폴더를 찾을 수 없습니다. 헤더의 폴더 다시 연결로 경로를 고쳐야 세션을 시작할 수 있습니다.
          </p>
        ) : null}

        <div className="folder-start-launchers">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className="folder-start-launcher"
              disabled={!canLaunch || !agent.available}
              onClick={() => onStartSession(agent.id)}
              /* The header's launcher row is on screen too, so this one takes the 상세 page's
                 wording rather than repeating `새 … 세션` and leaving two controls one name. */
              aria-label={`${agent.label} 세션 시작`}
              title={
                !agent.available
                  ? `${agent.label} 미설치`
                  : projectMissing
                    ? "세션을 시작하려면 먼저 폴더를 다시 연결하세요"
                    : newSessionLabel(agent)
              }
            >
              <AgentIcon agent={agent} size={24} className={agent.available ? agentAccentClass(agent) : undefined} />
              <span className="folder-start-launcher-label">{agent.label}</span>
              {agent.available ? null : <span className="folder-start-launcher-note">미설치</span>}
            </button>
          ))}
        </div>

        <p className="folder-start-layout-hint">첫 세션은 {layoutLabel} 배치로 열립니다</p>
      </div>

      <div className="folder-start-cards">
        <section className="folder-start-card" aria-label="Git 상태">
          <div className="folder-start-card-header">
            <h3>Git 상태</h3>
            <button
              className="icon-button"
              type="button"
              onClick={loadGitStatus}
              disabled={gitStatusLoading}
              aria-label="Git 상태 새로고침"
              title="Git 상태 새로고침"
            >
              <RefreshCw size={14} className={gitStatusLoading ? "spin" : undefined} />
            </button>
          </div>
          {gitStatusLoading ? (
            <p className="folder-start-empty">Git 상태 확인 중…</p>
          ) : gitStatusError ? (
            <p className="folder-start-empty">Git 상태를 읽을 수 없습니다</p>
          ) : gitStatus?.isRepo ? (
            <div className="git-status-row">
              <span className="git-branch">{gitStatus.branch ?? "분리된 HEAD"}</span>
              <span className="git-changes">
                {gitStatus.changedFileCount === 0 ? "변경 없음" : `변경 ${gitStatus.changedFileCount}개`}
              </span>
            </div>
          ) : (
            <p className="folder-start-empty">Git 저장소가 아닙니다</p>
          )}
        </section>

        <section className="folder-start-card" aria-label="워크트리">
          <div className="folder-start-card-header">
            <h3>워크트리</h3>
            <button
              className="icon-button"
              type="button"
              onClick={onCreateWorktree}
              disabled={projectMissing}
              aria-label="워크트리 만들기"
              title="워크트리 만들기"
            >
              <Plus size={14} />
            </button>
          </div>
          {worktrees.length === 0 ? (
            <p className="folder-start-empty">아직 워크트리가 없습니다</p>
          ) : (
            <ul className="folder-start-worktrees">
              {worktrees.map((candidate) => {
                const current = candidate.id === worktree?.id;
                return (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      className={`folder-start-worktree ${current ? "current" : ""}`.trim()}
                      disabled={current}
                      onClick={() => onSelectWorktree(candidate)}
                      aria-label={current ? `${candidate.branch} (보는 중)` : `${candidate.branch} 워크트리 열기`}
                      title={candidate.path}
                    >
                      <GitBranch size={13} aria-hidden="true" />
                      <span className="folder-start-worktree-branch">{candidate.branch}</span>
                      {current ? <span className="folder-start-worktree-note">보는 중</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="folder-start-card" aria-label="바로가기">
          <div className="folder-start-card-header">
            <h3>바로가기</h3>
          </div>
          <div className="folder-start-shortcuts">
            <button type="button" onClick={onOpenDetail}>
              <PanelsTopLeft size={14} />
              <span>폴더 상세</span>
            </button>
            <button type="button" onClick={onReveal}>
              <FolderOpen size={14} />
              <span>파일 탐색기에서 열기</span>
            </button>
            <button
              type="button"
              disabled={!vscodeAvailable}
              title={vscodeAvailable ? undefined : "PATH에서 VS Code를 찾을 수 없습니다"}
              onClick={onOpenInEditor}
            >
              <VSCodeIcon size={14} className="brand-icon-vscode" />
              <span>VS Code에서 열기</span>
            </button>
            <button type="button" onClick={onOpenOnGitHub}>
              <GitHubIcon size={14} />
              <span>GitHub에서 열기</span>
            </button>
          </div>
        </section>
      </div>
    </section>
  );
}
