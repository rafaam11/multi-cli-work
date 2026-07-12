import type { SharedProject } from "@shared/project-types";
import { useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

interface ProjectMetadataEditorProps {
  project: SharedProject;
  onSaved(project: SharedProject): void;
  onClose(): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ProjectMetadataEditor({ project, onSaved, onClose }: ProjectMetadataEditorProps) {
  const [displayName, setDisplayName] = useState(project.displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextDisplayName = displayName.trim() === "" ? null : displayName.trim();
    if (nextDisplayName === (project.displayName ?? null)) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await window.multiCliWork.projects.update(project.id, { displayName: nextDisplayName });
      onSaved(updated);
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  const nameId = `project-editor-name-${project.id}`;

  return (
    <form
      className="project-editor"
      role="dialog"
      aria-label={`${project.displayName ?? project.rootPath} 이름 변경`}
      onSubmit={(event) => void submit(event)}
      onKeyDown={handleKeyDown}
    >
      <div className="project-editor-field">
        <label htmlFor={nameId}>표시 이름</label>
        <input
          id={nameId}
          type="text"
          value={displayName}
          autoFocus
          placeholder={project.rootPath.split(/[\\/]/).filter(Boolean).at(-1)}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>
      {error ? (
        <div className="project-editor-error" role="alert">
          {error}
        </div>
      ) : null}
      <footer className="project-editor-actions">
        <button type="button" onClick={onClose} disabled={saving}>
          취소
        </button>
        <button type="submit" disabled={saving}>
          저장
        </button>
      </footer>
    </form>
  );
}
