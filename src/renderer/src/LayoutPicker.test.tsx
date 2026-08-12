import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GRID_LAYOUTS, MAX_COLUMNS, layoutById } from "./grid-layouts";
import { LayoutPicker } from "./LayoutPicker";

function renderPicker(overrides: Partial<Parameters<typeof LayoutPicker>[0]> = {}) {
  const props: Parameters<typeof LayoutPicker>[0] = {
    layoutId: "auto",
    paneCount: 4,
    onSelect: vi.fn(),
    ...overrides,
  };
  const result = render(<LayoutPicker {...props} />);
  return { ...result, props };
}

afterEach(cleanup);

describe("LayoutPicker", () => {
  it("shows 자동 and every preset without being opened", () => {
    renderPicker();
    expect(screen.getAllByRole("radio")).toHaveLength(GRID_LAYOUTS.length + 1);
    expect(screen.getByRole("radio", { name: "자동" })).toBeTruthy();
  });

  it("previews a layout with the same grid template the real grid draws", () => {
    renderPicker({ layoutId: "auto" });
    const layout = layoutById("cols:1-1-1-1-1-1")!;
    const preview = screen.getByRole("radio", { name: "6열" }).querySelector(".layout-preview") as HTMLElement;
    expect(preview.style.gridTemplateAreas).toBe(layout.areas);
    expect(preview.textContent).toBe("123456");
  });

  it("shows what 자동 would draw for the panes on screen right now", () => {
    renderPicker({ layoutId: "auto", paneCount: 5 });
    const preview = screen.getByRole("radio", { name: "자동" }).querySelector(".layout-preview") as HTMLElement;
    expect(preview.style.gridTemplateAreas).toBe(layoutById("cols:1-1-1-1-1")!.areas);
  });

  /**
   * One flat row, ordered as the catalog is. The per-count sections it replaced cost a line of
   * height in a header that has none to spare, and with two presets at most per count they were
   * labelling groups the user could already see.
   */
  it("lays the presets out in one row, 자동 first and then by column count", () => {
    renderPicker();
    expect(screen.queryByText("4칸")).toBeNull();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "자동",
      ...GRID_LAYOUTS.map((layout) => layout.label),
    ]);
  });

  /**
   * Only whole columns are offered. Splitting one is a decision about a single column and the pane
   * that owns it carries that button; all sixty-four combinations in this row would say the same
   * thing far worse.
   */
  it("offers one column through six, and never a stacked arrangement", () => {
    renderPicker();
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "자동",
      "1열",
      "2열",
      "3열",
      "4열",
      "5열",
      "6열",
    ]);
    for (let columns = 1; columns <= MAX_COLUMNS; columns += 1) {
      const preview = screen
        .getByRole("radio", { name: `${columns}열` })
        .querySelector(".layout-preview") as HTMLElement;
      expect(preview.style.gridTemplateRows).toBe("1fr");
    }
  });

  it("marks the layout in force, 자동 included", () => {
    const { rerender, props } = renderPicker({ layoutId: "auto" });
    expect(screen.getByRole("radio", { name: "자동" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "4열" }).getAttribute("aria-checked")).toBe("false");

    rerender(<LayoutPicker {...props} layoutId="cols:1-1-1-1" />);
    expect(screen.getByRole("radio", { name: "자동" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("radio", { name: "4열" }).getAttribute("aria-checked")).toBe("true");
  });

  /**
   * A tile is a picture of what the grid will draw. Pressing the current one clears the splits, so
   * the tooltip says so before the click rather than after.
   */
  it("marks the column count a split view has, and warns that the tile clears the splits", () => {
    renderPicker({ layoutId: "cols:1-2-1" });
    const tile = screen.getByRole("radio", { name: "3열" });
    expect(tile.getAttribute("aria-checked")).toBe("true");
    expect(tile.getAttribute("title")).toBe("3열 — 분할 해제");
    expect(screen.getByRole("radio", { name: "4열" }).getAttribute("aria-checked")).toBe("false");
  });

  it("marks the tile a view saved under a retired preset id lands on", () => {
    renderPicker({ layoutId: "6-grid" });
    expect(screen.getByRole("radio", { name: "3열" }).getAttribute("aria-checked")).toBe("true");
  });

  it("reports the chosen layout", () => {
    const { props } = renderPicker();
    fireEvent.click(screen.getByRole("radio", { name: "3열" }));
    expect(props.onSelect).toHaveBeenCalledWith("cols:1-1-1");
  });

  it("says where the panes that no longer fit go", () => {
    renderPicker();
    expect(screen.getByRole("radio", { name: "4열" }).getAttribute("title")).toContain(
      "넘치는 패인은 다음 페이지로",
    );
  });
});
