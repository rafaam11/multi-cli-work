import type { GitStatusResult, ProjectMetadataPatch, ProviderAvailability, TerminalSessionView } from "@shared/api-types";
import type { ProjectTrack, SharedProject } from "@shared/project-types";
import type { TerminalKind } from "@shared/terminal-types";
import { Code2, ExternalLink, FolderOpen, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { projectName, providerDetails, relativeTime, sessionLabel, statusLabels } from "./session-labels";

const TERMINAL_KINDS: TerminalKind[] = ["powershell", "claude", "codex"];

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
  sessions: TerminalSessionView[];
  availability: ProviderAvailability;
  pendingAction: boolean;
  onSelectSession(session: TerminalSessionView): void;
  onStartSession(kind: TerminalKind): void;
  onReveal(): void;
  onOpenInEditor(): void;
  onOpenOnGitHub(): void;
  onProjectSaved(project: SharedProject): void;
}

export function ProjectDetailPage({
  project,
  sessions,
  availability,
  pendingAction,
  onSelectSession,
  onStartSession,
  onReveal,
  onOpenInEditor,
  onOpenOnGitHub,
  onProjectSaved,
}: ProjectDetailPageProps) {
  const name = projectName(project);
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
    window.multiCliWork.projects
      .gitStatus(project.id)
      .then(setGitStatus)
      .catch((error) => setGitStatusError(errorMessage(error)))
      .finally(() => setGitStatusLoading(false));
  }, [project.id]);

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
                {TERMINAL_KINDS.map((kind) => {
                  const details = providerDetails[kind];
                  const Icon = details.icon;
                  return (
                    <button
                      key={kind}
                      type="button"
                      disabled={!availability[kind] || pendingAction}
                      onClick={() => onStartSession(kind)}
                      aria-label={`${details.label} 세션 시작`}
                    >
                      <Icon size={15} />
                      <span>{details.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <ul className="session-card-list">
              {sessions.map((session) => {
                const label = sessionLabel(session, sessions);
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
              disabled={!availability.vscode}
              title={availability.vscode ? undefined : "PATH에서 VS Code를 찾을 수 없습니다"}
              onClick={onOpenInEditor}
            >
              <Code2 size={14} />
              <span>VS Code에서 열기</span>
            </button>
            <button type="button" onClick={onOpenOnGitHub}>
              <ExternalLink size={14} />
              <span>GitHub에서 열기</span>
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
      </div>
    </section>
  );
}
