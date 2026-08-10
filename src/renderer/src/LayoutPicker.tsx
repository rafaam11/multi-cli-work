import {
  AUTO_LAYOUT_ID,
  autoLayoutFor,
  isAutoLayout,
  layoutGroups,
  type GridLayout,
} from "./grid-layouts";

interface LayoutPickerProps {
  layoutId: string;
  /** How many panes the view holds, so 자동 can preview the arrangement it would draw right now. */
  paneCount: number;
  onSelect(layoutId: string): void;
}

/** The same `grid-template-*` the real grid uses, at tile size — the preview cannot drift from it. */
function LayoutPreview({ layout }: { layout: GridLayout }) {
  return (
    <span
      className="layout-preview"
      aria-hidden="true"
      style={{
        gridTemplateColumns: layout.columns,
        gridTemplateRows: layout.rows,
        gridTemplateAreas: layout.areas,
      }}
    >
      {Array.from({ length: layout.slots }, (_, index) => (
        <span key={index} style={{ gridArea: `s${index + 1}` }}>
          {index + 1}
        </span>
      ))}
    </span>
  );
}

/**
 * Every arrangement, laid out along the top of the workspace rather than hidden behind a popup —
 * switching between them is a routine move, so it costs one click. The layout decides how many slots
 * exist, so this is also where a user says how many panes they want at once; sessions past that
 * count move to the next page rather than disappearing, which the row says out loud.
 */
export function LayoutPicker({ layoutId, paneCount, onSelect }: LayoutPickerProps) {
  const auto = isAutoLayout(layoutId);

  return (
    <div className="layout-bar" role="radiogroup" aria-label="레이아웃 선택">
      <button
        type="button"
        role="radio"
        aria-checked={auto}
        aria-label="자동"
        title="자동 — 세션 수에 맞춰"
        className={`layout-option ${auto ? "current" : ""}`}
        onClick={() => onSelect(AUTO_LAYOUT_ID)}
      >
        <LayoutPreview layout={autoLayoutFor(paneCount)} />
        <span className="layout-option-label">자동</span>
      </button>
      {layoutGroups().map((group) => (
        <div className="layout-bar-group" key={group.slots}>
          <span className="layout-bar-title" aria-hidden="true">
            {group.slots}칸
          </span>
          <div className="layout-bar-options">
            {group.layouts.map((layout) => (
              <button
                key={layout.id}
                type="button"
                role="radio"
                aria-checked={!auto && layout.id === layoutId}
                aria-label={`${layout.label} (${layout.slots}칸)`}
                title={`${layout.label} — ${layout.slots}칸. 넘치는 패인은 다음 페이지로 갑니다`}
                className={`layout-option ${!auto && layout.id === layoutId ? "current" : ""}`}
                onClick={() => onSelect(layout.id)}
              >
                <LayoutPreview layout={layout} />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
