import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GRID_LAYOUTS, layoutById } from "./grid-layouts";
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
    renderPicker({ layoutId: "6-grid" });
    const layout = layoutById("6-row-pairs")!;
    const preview = screen
      .getByRole("radio", { name: "2×3 (6칸)" })
      .querySelector(".layout-preview") as HTMLElement;
    expect(preview.style.gridTemplateAreas).toBe(layout.areas);
    expect(preview.textContent).toBe("123456");
  });

  it("shows what 자동 would draw for the panes on screen right now", () => {
    renderPicker({ layoutId: "auto", paneCount: 5 });
    const preview = screen.getByRole("radio", { name: "자동" }).querySelector(".layout-preview") as HTMLElement;
    expect(preview.style.gridTemplateAreas).toBe(layoutById("5-thirds-split")!.areas);
  });

  it("marks the layout in force, 자동 included", () => {
    const { rerender, props } = renderPicker({ layoutId: "auto" });
    expect(screen.getByRole("radio", { name: "자동" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "2×2 (4칸)" }).getAttribute("aria-checked")).toBe("false");

    rerender(<LayoutPicker {...props} layoutId="4-quad" />);
    expect(screen.getByRole("radio", { name: "자동" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("radio", { name: "2×2 (4칸)" }).getAttribute("aria-checked")).toBe("true");
  });

  it("reports the chosen layout", () => {
    const { props } = renderPicker();
    fireEvent.click(screen.getByRole("radio", { name: "메인 + 우측 2 (3칸)" }));
    expect(props.onSelect).toHaveBeenCalledWith("3-main-right");
  });

  it("says where the panes that no longer fit go", () => {
    renderPicker();
    expect(screen.getByRole("radio", { name: "2×2 (4칸)" }).getAttribute("title")).toContain(
      "넘치는 패인은 다음 페이지로",
    );
  });
});
