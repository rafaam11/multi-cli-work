import { Tags } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { tagAccentClass } from "./tag-color";

export interface TagGroupingPickerProps {
  /** 지금 어딘가에 붙어 있는 태그들. 많이 쓰인 것이 앞이다(knownTags). */
  available: readonly string[];
  /** 묶기에 쓰이는 태그를 고른 순서대로. 트리는 이 순서로 훑는다. */
  selected: readonly string[];
  /** 저장된 선호 없이 파생 기본값이 도는 중이라는 뜻 — 버튼이 `(자동)`이라고 밝힌다. */
  isDefault: boolean;
  onChange(tags: string[]): void;
}

/**
 * 트리 컨트롤 줄 오른쪽의 묶기 버튼. 순서 재배치(↑↓)는 일부러 만들지 않는다 — 해제하고 다시
 * 고르면 되는 일에 화살표 두 개를 더 놓으면, 22px 줄에 누를 것이 여섯이 된다.
 */
export function TagGroupingPicker({ available, selected, isDefault, onChange }: TagGroupingPickerProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const label = `묶기: ${selected.length > 0 ? selected.join(" › ") : "없음"}${isDefault ? " (자동)" : ""}`;
  /**
   * 줄 순서는 후보 순서로 고정이다 — 고른 것을 앞으로 끌어내면 방금 누른 줄이 발밑에서 자리를
   * 옮기고, 연달아 둘을 고르는 이 메뉴에서 그것은 조준을 다시 하게 만든다. 고른 **순서**는
   * 버튼 텍스트(`묶기: a › b`)가 따로 말해 주므로 목록까지 그 일을 할 필요가 없다.
   *
   * 뒤에 붙는 것은 마지막 업무 프로젝트에서 떨어져 나가 `available`에서 사라진 태그다. 아직
   * 묶기에 남아 있으면 항목이 서야 해제할 수 있다 — 아니면 버튼에는 보이는데 뺄 길이 없어진다.
   */
  const items = [...available, ...selected.filter((tag) => !available.includes(tag))];

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="grouping-picker" ref={root}>
      <button
        type="button"
        className="grouping-picker-button"
        onClick={() => setOpen((value) => !value)}
        aria-label="묶기 설정"
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
      >
        <Tags size={13} />
        <span className="grouping-picker-value">{label}</span>
      </button>
      {open ? (
        <div className="grouping-picker-menu" role="menu" aria-label="묶기 설정">
          {items.length === 0 ? (
            <p className="grouping-picker-empty">태그 없음</p>
          ) : (
            items.map((tag) => (
              <button
                key={tag}
                type="button"
                role="menuitemcheckbox"
                aria-checked={selected.includes(tag)}
                className={`grouping-picker-item ${tagAccentClass(tag)}`}
                // 고르면 끝에 붙고 해제하면 빠진다 — 메뉴는 열린 채로 남아 연달아 고를 수 있다.
                onClick={() =>
                  onChange(
                    selected.includes(tag)
                      ? selected.filter((entry) => entry !== tag)
                      : [...selected, tag],
                  )
                }
              >
                <span className="grouping-picker-swatch" aria-hidden="true" />
                <span className="grouping-picker-tag">{tag}</span>
              </button>
            ))
          )}
          <div className="grouping-picker-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="grouping-picker-clear"
            onClick={() => {
              setOpen(false);
              onChange([]);
            }}
          >
            묶기 해제
          </button>
        </div>
      ) : null}
    </div>
  );
}
