import { useEffect, useState } from "react";
import type { RemoteCatalog } from "@shared/remote-types";

interface NewSessionFormProps {
  /** 호스트에 물어 둔 폴더·에이전트 목록. 아직 답이 없으면 null. */
  catalog: RemoteCatalog | null;
  /** worktreeId가 null이면 폴더 루트에서 시작한다. */
  onStart(projectId: string, kind: string, worktreeId: string | null): void;
  onCancel(): void;
}

/**
 * 호스트 PC에 새 세션을 띄우는 폼. 어디서(폴더, 있으면 그 안의 워크트리) 무엇을(에이전트) 돌릴지만 고른다 — 시작 크기는
 * MobileApp이 이 화면에 맞게 어림해 싣고, 열린 뒤에는 다른 세션과 같은 규칙으로 맞춘다.
 */
export function NewSessionForm({ catalog, onStart, onCancel }: NewSessionFormProps) {
  const [projectId, setProjectId] = useState("");
  const [kind, setKind] = useState("");
  /** 고른 폴더 안의 작업 위치. 빈 문자열이 폴더 루트다. */
  const [worktreeId, setWorktreeId] = useState("");

  // 목록이 오면 첫 항목을 골라 둔다. 고른 것이 목록에서 사라졌을 때도 마찬가지다.
  useEffect(() => {
    if (!catalog) return;
    setProjectId((current) =>
      catalog.projects.some((project) => project.id === current) ? current : (catalog.projects[0]?.id ?? ""),
    );
    setKind((current) => (catalog.agents.some((agent) => agent.id === current) ? current : (catalog.agents[0]?.id ?? "")));
  }, [catalog]);

  if (!catalog) {
    return (
      <form className="m-new-session" onSubmit={(event) => event.preventDefault()}>
        <p className="m-empty">불러오는 중…</p>
        <div className="m-new-session-actions">
          <button type="button" onClick={onCancel}>
            취소
          </button>
        </div>
      </form>
    );
  }

  const ready = projectId !== "" && kind !== "";
  const worktrees = catalog.projects.find((project) => project.id === projectId)?.worktrees ?? [];

  return (
    <form
      className="m-new-session"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onStart(projectId, kind, worktreeId === "" ? null : worktreeId);
      }}
    >
      {catalog.projects.length === 0 ? (
        <p className="m-notice">호스트에 등록된 폴더가 없습니다</p>
      ) : (
        <label>
          폴더
          <select
            value={projectId}
            onChange={(event) => {
              // 워크트리는 폴더마다 다르다 — 폴더를 바꾸면 루트로 돌아간다.
              setProjectId(event.target.value);
              setWorktreeId("");
            }}
          >
            {catalog.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {worktrees.length > 0 ? (
        <label>
          작업 위치
          <select value={worktreeId} onChange={(event) => setWorktreeId(event.target.value)}>
            <option value="">루트</option>
            {worktrees.map((worktree) => (
              <option key={worktree.id} value={worktree.id}>
                {worktree.branch}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {catalog.agents.length === 0 ? (
        <p className="m-notice">호스트에서 실행할 수 있는 에이전트가 없습니다</p>
      ) : (
        <label>
          에이전트
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            {catalog.agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="m-new-session-actions">
        <button type="submit" disabled={!ready}>
          시작
        </button>
        <button type="button" onClick={onCancel}>
          취소
        </button>
      </div>
    </form>
  );
}
