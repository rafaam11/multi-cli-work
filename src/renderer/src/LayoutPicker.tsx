import { AUTO_LAYOUT_ID, GRID_LAYOUTS, autoLayoutFor, isAutoLayout, layoutById, type GridLayout } from "./grid-layouts";

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
 * How many columns, in one row, riding in the workspace header beside the launchers rather than
 * costing the grid a row of its own — a terminal's height is the scarce thing on this screen.
 * Switching is a routine move, so it stays one click: no popup, no per-count sections.
 *
 * Only whole columns are offered. Splitting one is a decision about a single column, and the pane
 * that owns it carries that button; putting all sixty-four combinations in this row would say the
 * same thing far worse.
 *
 * A view whose columns are split still marks the tile for its column count, and pressing that tile
 * clears the splits — the tile is a picture of what the grid will draw, and it would be lying if
 * pressing it left stacked panes behind. The tooltip says so before the click.
 */
export function LayoutPicker({ layoutId, paneCount, onSelect }: LayoutPickerProps) {
  const auto = isAutoLayout(layoutId);
  const current = auto ? null : layoutById(layoutId);
  const currentColumns = current?.columnRows.length ?? 0;
  const currentSplit = current?.columnRows.some((rows) => rows > 1) ?? false;

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
      {GRID_LAYOUTS.map((layout) => {
        const isCurrent = layout.columnRows.length === currentColumns;
        return (
          <button
            key={layout.id}
            type="button"
            role="radio"
            aria-checked={isCurrent}
            aria-label={layout.label}
            title={
              isCurrent && currentSplit
                ? `${layout.label} — 분할 해제`
                : `${layout.label}. 넘치는 패인은 다음 페이지로 갑니다`
            }
            className={`layout-option ${isCurrent ? "current" : ""}`}
            onClick={() => onSelect(layout.id)}
          >
            <LayoutPreview layout={layout} />
          </button>
        );
      })}
    </div>
  );
}
