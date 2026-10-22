import { findFolderTemplate, type ProjectFolderTemplate } from "@shared/folder-template";

interface FolderTemplatePickerProps {
  templates: readonly ProjectFolderTemplate[];
  /** 고른 템플릿 id. null이면 템플릿 없이 빈 폴더만 만든다. */
  value: string | null;
  onChange(next: string | null): void;
  className?: string;
}

/** 드라이브 폴더를 만들 때 쓸 템플릿 — 고른 템플릿의 폴더 목록을 바로 아래에 보여 준다. */
export function FolderTemplatePicker({ templates, value, onChange, className }: FolderTemplatePickerProps) {
  const selected = findFolderTemplate(templates, value ?? undefined);
  return (
    <div className={`folder-template-picker${className ? ` ${className}` : ""}`}>
      <label>
        <span>폴더 템플릿</span>
        <select
          aria-label="폴더 템플릿"
          value={selected?.id ?? ""}
          onChange={(event) => onChange(event.target.value.length > 0 ? event.target.value : null)}
        >
          <option value="">없음 (빈 폴더)</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <p className="folder-template-preview">{[...selected.folders, "CLAUDE.md"].join(" · ")}</p>
      ) : null}
    </div>
  );
}
