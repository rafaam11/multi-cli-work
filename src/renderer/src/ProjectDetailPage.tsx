import type { AgentView } from "@shared/agent-types";
import type { GitStatusResult, ProjectMetadataPatch, TerminalSessionView } from "@shared/api-types";
import type { ActivePullRequestReview } from "@shared/github-types";
import type { ProjectTrack, SharedProject } from "@shared/project-types";
import type { TerminalKind } from "@shared/terminal-types";
import type { GitWorkspaceView, SharedWorktree } from "@shared/worktree-types";
import { FileDiff, FolderOpen, GitBranch, Plus, RefreshCw, Send, Trash2, TriangleAlert } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useState } from "react";
import { AgentIcon, GitHubIcon, VSCodeIcon, agentAccentClass } from "./brand-icons";
import { projectName, relativeTime, sessionLabel, statusLabels } from "./session-labels";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toggleTrackItem(tracks: ProjectTrack[], trackId: string, itemId: string): ProjectTrack[] {
  return tracks.map((track) =>
    track.id !== trackId
      ? track
      : { ...track, items: track.items.map((item) => (item.id === itemId ? { ...item, done: !item.done } : item)) },
  );
}

function addTrackItem(tracks: ProjectTrack[], trackId: string, text: string): ProjectTrack[] {
  return tracks.map((track) =>
    track.id !== trackId ? track : { ...track, items: [...track.items, { id: crypto.randomUUID(), text, done: false }] },
  );
}

function removeTrackItem(tracks: ProjectTrack[], trackId: string, itemId: string): ProjectTrack[] {
  return tracks.map((track) => (track.id !== trackId ? track : { ...track, items: track.items.filter((item) => item.id !== itemId) }));
}

function addTrack(tracks: ProjectTrack[], title: string): ProjectTrack[] {
  return [...tracks, { id: crypto.randomUUID(), title, items: [] }];
}

function removeTrack(tracks: ProjectTrack[], trackId: string): ProjectTrack[] {
  return tracks.filter((track) => track.id !== trackId);
}

function NewTrackForm({ onAdd }: { onAdd(title: string): void }) {
  const [title, setTitle] = useState("");
  return (
    <form
      className="detail-new-track"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = title.trim();
        if (!trimmed) return;
        onAdd(trimmed);
        setTitle("");
      }}
    >
      <input
        type="text"
        aria-label="새 체크리스트 제목"
        placeholder="새 체크리스트…"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <button type="submit">체크리스트 추가</button>
    </form>
  );
}

function NewItemForm({ trackTitle, onAdd }: { trackTitle: string; onAdd(text: string): void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="detail-new-item"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = text.trim();
        if (!trimmed) return;
        onAdd(trimmed);
        setText("");
      }}
    >
      <input
        type="text"
        aria-label={`${trackTitle}에 항목 추가`}
        placeholder="항목 추가…"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit">추가</button>
    </form>
  );
}

interface ProjectDetailPageProps {
  project: SharedProject;
  /** When set, the page is scoped to this worktree: its sessions, its git state, its directory. */
  worktree: SharedWorktree | null;
  sessions: TerminalSessionView[];
  agents: AgentView[];
  vscodeAvailable: boolean;
  pendingAction: boolean;
  /** Already narrowed to this project — the page never filters by `projectId` itself. */
  worktrees: SharedWorktree[];
  workspaceViews: GitWorkspaceView[];
  activeReviews: ActivePullRequestReview[];
  /** worktreeId → session count, so the page does not have to hold every session. */
  worktreeSessionCounts: Record<string, number>;
  worktreeWarning: string | null;
  /** The folder's root is gone from disk — nothing here can start until it is relinked. */
  projectMissing: boolean;
  onSelectSession(session: TerminalSessionView): void;
  onStartSession(kind: TerminalKind): void;
  onReveal(): void;
  onOpenInEditor(): void;
  onOpenOnGitHub(): void;
  onFanOut(): void;
  onShowDiff(): void;
  onProjectSaved(project: SharedProject): void;
  onSelectWorktree(worktree: SharedWorktree): void;
  onCreateWorktree(): void;
  onWorktreeContextMenu(worktree: SharedWorktree, event: ReactMouseEvent): void;
}

export function ProjectDetailPage({
  project,
  worktree,
  sessions,
  agents,
  vscodeAvailable,
  pendingAction,
  worktrees,
  workspaceViews,
  activeReviews,
  worktreeSessionCounts,
  worktreeWarning,
  projectMissing,
  onSelectSession,
  onStartSession,
  onReveal,
  onOpenInEditor,
  onOpenOnGitHub,
  onFanOut,
  onShowDiff,
  onProjectSaved,
  onSelectWorktree,
  onCreateWorktree,
  onWorktreeContextMenu,
}: ProjectDetailPageProps) {
  const name = worktree ? `${projectName(project)} · ${worktree.branch}` : projectName(project);
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
  const [gitStatusLoading, setGitStatusLoading] = useState(false);
  const [gitStatusError, setGitStatusError] = useState<string | null>(null);
  const [memo, setMemo] = useState(project.memo);
  const [tracks, setTracks] = useState(project.tracks);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // Only resync on a genuine project switch — resetting on every save-triggered prop update
    // would discard memo keystrokes typed between an unrelated tracks save and this effect.
    setMemo(project.memo);
    setTracks(project.tracks);
  }, [project.id]);

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

  const saveMetadata = async (patch: ProjectMetadataPatch) => {
    setSaveError(null);
    try {
      const updated = await window.multiCliWork.projects.update(project.id, patch);
      onProjectSaved(updated);
    } catch (error) {
      setSaveError(errorMessage(error));
    }
  };

  // Same order as the sidebar tree: throwaway PR-review worktrees sink below the ones you named,
  // and sorting a copy keeps the caller's array untouched.
  const sortedWorktrees = useMemo(
    () =>
      [...worktrees].sort((left, right) => {
        const leftReview = activeReviews.find((review) => review.worktreeId === left.id);
        const rightReview = activeReviews.find((review) => review.worktreeId === right.id);
        if (leftReview && rightReview) return leftReview.pullRequestNumber - rightReview.pullRequestNumber;
        if (leftReview) return 1;
        if (rightReview) return -1;
        return left.branch.localeCompare(right.branch);
      }),
    [worktrees, activeReviews],
  );

  const mutateTracks = (mutate: (current: ProjectTrack[]) => ProjectTrack[]) => {
    const next = mutate(tracks);
    setTracks(next);
    void saveMetadata({ tracks: next });
  };

  return (
    <section className="project-detail" aria-label="프로젝트 상세">
      <div className="detail-grid">
        <section className="detail-card detail-card-sessions" aria-label="세션">
          <h2>세션</h2>
          {sessions.length === 0 ? (
            <div className="detail-empty-sessions">
              <h3>{name}에서 세션 시작</h3>
              <div className="detail-launcher-row">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    disabled={!agent.available || pendingAction}
                    onClick={() => onStartSession(agent.id)}
                    aria-label={`${agent.label} 세션 시작`}
                  >
                    <AgentIcon
                      agent={agent}
                      size={15}
                      className={agent.available ? agentAccentClass(agent) : undefined}
                    />
                    <span>{agent.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ul className="session-card-list">
              {sessions.map((session) => {
                const label = sessionLabel(session, sessions, agents);
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      className={`session-card status-${session.status}`}
                      onClick={() => onSelectSession(session)}
                      aria-label={`${label} 세션 보기`}
                    >
                      <span className={`status-dot status-${session.status}`} aria-hidden="true" />
                      <span className="session-card-name">{label}</span>
                      <span className="session-card-status">{statusLabels[session.status]}</span>
                      <span className="session-card-updated">{relativeTime(session.updatedAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="detail-card" aria-label="빠른 작업">
          <h2>빠른 작업</h2>
          <div className="detail-actions-row">
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
            <button type="button" onClick={onFanOut}>
              <Send size={14} />
              <span>프롬프트 팬아웃</span>
            </button>
            <button type="button" onClick={onShowDiff}>
              <FileDiff size={14} />
              <span>변경 보기</span>
            </button>
          </div>
        </section>

        <section className="detail-card" aria-label="Git 상태">
          <div className="detail-card-header">
            <h2>Git 상태</h2>
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
            <p className="detail-empty">Git 상태 확인 중…</p>
          ) : gitStatusError ? (
            <p className="detail-empty">Git 상태를 읽을 수 없습니다</p>
          ) : gitStatus?.isRepo ? (
            <div className="git-status-row">
              <span className="git-branch">{gitStatus.branch ?? "분리된 HEAD"}</span>
              <span className="git-changes">
                {gitStatus.changedFileCount === 0 ? "변경 없음" : `변경 ${gitStatus.changedFileCount}개`}
              </span>
            </div>
          ) : (
            <p className="detail-empty">Git 저장소가 아닙니다</p>
          )}
        </section>

        <section className="detail-card" aria-label="워크트리">
          <div className="detail-card-header">
            <h2>워크트리</h2>
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
          {worktreeWarning ? (
            <p className="detail-worktree-warning" role="status">
              <TriangleAlert size={13} />
              {worktreeWarning}
            </p>
          ) : null}
          {worktrees.length === 0 ? (
            <p className="detail-empty">아직 워크트리가 없습니다</p>
          ) : (
            <ul className="detail-worktrees">
              {sortedWorktrees.map((candidate) => {
                const view = workspaceViews.find((item) => item.worktreeId === candidate.id);
                const review = activeReviews.find((item) => item.worktreeId === candidate.id);
                const current = candidate.id === worktree?.id;
                const branchLabel = review
                  ? `PR #${review.pullRequestNumber} · 임시`
                  : (view?.branch ?? (view?.head ? `detached @ ${view.head.slice(0, 7)}` : candidate.branch));
                const flags = [
                  view?.lockedReason ? "locked" : null,
                  view?.availability === "missing" ? "missing" : null,
                  view?.prunableReason ? "prunable" : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li key={candidate.id}>
                    {/* The menu hangs off the wrapper — on the row you are viewing the button is
                        disabled, and a disabled button fires no events of its own. */}
                    <div
                      className="detail-worktree-row"
                      onContextMenu={(event) => onWorktreeContextMenu(candidate, event)}
                    >
                      <button
                        type="button"
                        className={`detail-worktree ${current ? "current" : ""}`.trim()}
                        disabled={current}
                        onClick={() => onSelectWorktree(candidate)}
                        aria-label={current ? `${candidate.branch} (보는 중)` : `${candidate.branch} 워크트리 열기`}
                        title={candidate.path}
                      >
                        <GitBranch size={13} aria-hidden="true" />
                        <span className="detail-worktree-branch">
                          {branchLabel}
                          {flags ? ` · ${flags}` : ""}
                        </span>
                        <span className="detail-worktree-meta">
                          변경 {view?.changedFileCount ?? 0} · 세션 {worktreeSessionCounts[candidate.id] ?? 0}
                        </span>
                        {current ? <span className="detail-worktree-note">보는 중</span> : null}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Memo and checklists are project metadata; editing them from a worktree page would
            silently write to the whole project, so the card only shows at the project root. */}
        {worktree ? null : (
        <section className="detail-card detail-card-notes" aria-label="메모">
          <h2>메모</h2>
          {saveError ? (
            <p className="detail-save-error" role="alert">
              {saveError}
            </p>
          ) : null}
          <label className="detail-memo-label" htmlFor={`detail-memo-${project.id}`}>
            메모 내용
          </label>
          <textarea
            id={`detail-memo-${project.id}`}
            className="detail-memo"
            value={memo}
            placeholder="이 프로젝트에 대한 메모…"
            onChange={(event) => setMemo(event.target.value)}
            onBlur={() => {
              if (memo !== project.memo) void saveMetadata({ memo });
            }}
          />

          <div className="detail-tracks">
            {tracks.map((track) => (
              <div className="detail-track" key={track.id}>
                <div className="detail-track-header">
                  <span>{track.title}</span>
                  <button
                    type="button"
                    aria-label={`${track.title} 체크리스트 삭제`}
                    onClick={() => mutateTracks((current) => removeTrack(current, track.id))}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <ul className="detail-track-items">
                  {track.items.map((item) => (
                    <li key={item.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={item.done}
                          onChange={() => mutateTracks((current) => toggleTrackItem(current, track.id, item.id))}
                        />
                        <span className={item.done ? "done" : undefined}>{item.text}</span>
                      </label>
                      <button
                        type="button"
                        aria-label={`${item.text} 항목 삭제`}
                        onClick={() => mutateTracks((current) => removeTrackItem(current, track.id, item.id))}
                      >
                        <Trash2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
                <NewItemForm trackTitle={track.title} onAdd={(text) => mutateTracks((current) => addTrackItem(current, track.id, text))} />
              </div>
            ))}
            <NewTrackForm onAdd={(title) => mutateTracks((current) => addTrack(current, title))} />
          </div>
        </section>
        )}
      </div>
    </section>
  );
}
