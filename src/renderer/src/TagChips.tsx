import { tagAccentClass } from "./tag-color";

export interface TagChipsProps {
  tags: readonly string[];
  /** 한 줄에 보일 최대 칩 수 — 넘는 태그는 개수 배지 하나로 접힌다. */
  max?: number;
}

/**
 * 업무 프로젝트 태그를 트리 행과 홈 카드가 똑같이 그리는 조각. 태그가 없는 프로젝트는 빈 칩이
 * 자리를 차지하지 않도록 아무것도 그리지 않고, `max`를 넘는 칩은 `+N` 배지로 접혀 `title`에서
 * 나머지 이름을 읽을 수 있다 — 화면마다 다른 개수를 잘라 보여줘도 넘친 태그가 사라지지 않는다.
 */
export function TagChips({ tags, max = 3 }: TagChipsProps): JSX.Element | null {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const overflow = tags.slice(max);
  return (
    <span className="tag-chip-list">
      {shown.map((tag) => (
        <span key={tag} className={`tag-chip ${tagAccentClass(tag)}`} title={tag}>
          {tag}
        </span>
      ))}
      {overflow.length > 0 ? (
        <span className="tag-chip-more" title={overflow.join(", ")}>
          +{overflow.length}
        </span>
      ) : null}
    </span>
  );
}
