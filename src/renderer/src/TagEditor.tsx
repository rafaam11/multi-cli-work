import { MAX_TAG_LENGTH, normalizeTags } from "@shared/project-tags-types";
import { useId, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { tagAccentClass } from "./tag-color";

export interface TagEditorProps {
  tags: readonly string[];
  /** 자동완성 후보. 이미 붙은 태그는 목록에서 빠진다 — 고를 수 없는 항목을 보여줄 이유가 없다. */
  suggestions: readonly string[];
  disabled?: boolean;
  onChange(tags: string[]): void;
}

/**
 * 칩과 입력칸이 한 상자에 든 자유 태그 편집기. 커밋은 언제나 `normalizeTags`를 지나므로 화면에서
 * 만들 수 있는 목록은 레지스트리가 저장하는 목록과 같다 — 중복·공백·32자 초과가 여기서 걸러진다.
 */
export function TagEditor({ tags, suggestions, disabled, onChange }: TagEditorProps) {
  const [draft, setDraft] = useState("");
  const listId = useId();

  /** 실제로 늘어난 것이 있을 때만 알린다 — 중복은 조용히 삼킨다. */
  const commit = (values: string[]) => {
    const next = normalizeTags([...tags, ...values]);
    if (next.length === normalizeTags(tags).length) return;
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(normalizeTags(tags.filter((_, at) => at !== index)));
  };

  // 붙여넣기와, 조합 중에 눌려 입력칸으로 새어 들어온 쉼표를 받아 낸다. 마지막 조각은 아직
  // 타이핑 중인 값이므로 커밋하지 않고 입력칸에 남긴다.
  const handleInput = (value: string) => {
    if (!value.includes(",")) {
      setDraft(value);
      return;
    }
    const parts = value.split(",");
    const rest = parts.pop() ?? "";
    commit(parts);
    setDraft(rest);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // 한글 조합을 확정하는 Enter는 커밋이 아니다 — 여기서 걸러 내지 않으면 "개인"을 치다 만
    // "개"가 태그로 굳는다. 조합 중의 쉼표·Backspace도 같은 이유로 IME에 넘긴다.
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit([draft]);
      setDraft("");
      return;
    }
    if (event.key === "Backspace" && draft.length === 0 && tags.length > 0) {
      event.preventDefault();
      remove(tags.length - 1);
    }
  };

  const unused = suggestions.filter((suggestion) => !tags.includes(suggestion));

  return (
    <div className="tag-editor">
      {tags.map((tag, index) => (
        <span key={tag} className={`tag-editor-chip ${tagAccentClass(tag)}`}>
          {tag}
          <button
            type="button"
            aria-label={`${tag} 태그 제거`}
            title="태그 제거"
            disabled={disabled}
            onClick={() => remove(index)}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="tag-editor-input"
        type="text"
        value={draft}
        maxLength={MAX_TAG_LENGTH}
        list={listId}
        aria-label="태그 추가"
        placeholder="태그 추가…"
        disabled={disabled}
        onChange={(event) => handleInput(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <datalist id={listId}>
        {unused.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
    </div>
  );
}
