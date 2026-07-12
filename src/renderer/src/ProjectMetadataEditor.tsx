import type { ProjectMetadataPatch } from "@shared/api-types";
import type { ProjectStatus, SharedProject } from "@shared/project-types";
import { useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

const STATUS_OPTIONS: ProjectStatus[] = ["진행중", "보류", "완료", "보관"];

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
  const [status, setStatus] = useState<ProjectStatus | "">(project.status ?? "");
  const [memo, setMemo] = useState(project.memo);
  const [hidden, setHidden] = useState(project.hidden);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildPatch = (): ProjectMetadataPatch => {
    const patch: ProjectMetadataPatch = {};
    const nextDisplayName = displayName.trim() === "" ? null : displayName.trim();
    if (nextDisplayName !== (project.displayName ?? null)) patch.displayName = nextDisplayName;
    const nextStatus = status === "" ? null : status;
    if (nextStatus !== project.status) patch.status = nextStatus;
    if (memo !== project.memo) patch.memo = memo;
    if (hidden !== project.hidden) patch.hidden = hidden;
    return patch;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await window.multiCliWork.projects.update(project.id, patch);
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
  const statusId = `project-editor-status-${project.id}`;
  const memoId = `project-editor-memo-${project.id}`;
  const hiddenId = `project-editor-hidden-${project.id}`;

  return (
    <form
      className="project-editor"
      role="dialog"
      aria-label={`Edit project ${project.displayName ?? project.rootPath}`}
      onSubmit={(event) => void submit(event)}
      onKeyDown={handleKeyDown}
    >
      <div className="project-editor-field">
        <label htmlFor={nameId}>Display name</label>
        <input id={nameId} type="text" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </div>
      <div className="project-editor-field">
        <label htmlFor={statusId}>Status</label>
        <select id={statusId} value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus | "")}>
          <option value="">None</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>
      <div className="project-editor-field">
        <label htmlFor={memoId}>Memo</label>
        <textarea id={memoId} rows={3} value={memo} onChange={(event) => setMemo(event.target.value)} />
      </div>
      <div className="project-editor-field project-editor-checkbox">
        <input id={hiddenId} type="checkbox" checked={hidden} onChange={(event) => setHidden(event.target.checked)} />
        <label htmlFor={hiddenId}>Hidden</label>
      </div>
      {error ? (
        <div className="project-editor-error" role="alert">
          {error}
        </div>
      ) : null}
      <footer className="project-editor-actions">
        <button type="button" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="submit" disabled={saving}>
          Save
        </button>
      </footer>
    </form>
  );
}
