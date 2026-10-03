import { useEffect, useState } from "react";
import type { RemoteCatalog } from "@shared/remote-types";

interface NewSessionFormProps {
  /** 호스트에 물어 둔 폴더·에이전트 목록. 아직 답이 없으면 null. */
  catalog: RemoteCatalog | null;
  onStart(projectId: string, kind: string): void;
  onCancel(): void;
}

/**
 * 호스트 PC에 새 세션을 띄우는 폼. 어디서(폴더) 무엇을(에이전트) 돌릴지만 고른다 — 터미널 크기는
 * 호스트가 정하고, 열린 뒤에 다른 세션과 같은 규칙으로 맞춘다.
 */
export function NewSessionForm({ catalog, onStart, onCancel }: NewSessionFormProps) {
  const [projectId, setProjectId] = useState("");
  const [kind, setKind] = useState("");

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

  return (
    <form
      className="m-new-session"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onStart(projectId, kind);
      }}
    >
      {catalog.projects.length === 0 ? (
        <p className="m-notice">호스트에 등록된 폴더가 없습니다</p>
      ) : (
        <label>
          폴더
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {catalog.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      )}
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
