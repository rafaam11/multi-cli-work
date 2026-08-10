import { AUTO_LAYOUT_ID, GRID_LAYOUTS, autoLayoutFor, isAutoLayout, type GridLayout } from "./grid-layouts";

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
 * Every arrangement in one row, riding in the workspace header beside the launchers rather than
 * costing the grid a row of its own — a terminal's height is the scarce thing on this screen.
 * Switching is a routine move, so it stays one click: no popup, no per-count sections. The tiles
 * read as the catalog does, 자동 first and then the presets in ascending slot count, and since the
 * layout decides how many slots exist this is also where a user says how many panes they want at
 * once. Sessions past that count move to the next page rather than disappearing, which the tile's
 * own tooltip says out loud.
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
        className={`layout-option layout-option-auto ${auto ? "current" : ""}`}
        onClick={() => onSelect(AUTO_LAYOUT_ID)}
      >
        <LayoutPreview layout={autoLayoutFor(paneCount)} />
        <span className="layout-option-label">자동</span>
      </button>
      <span className="layout-bar-divider" aria-hidden="true" />
      {GRID_LAYOUTS.map((layout) => (
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
  );
}
