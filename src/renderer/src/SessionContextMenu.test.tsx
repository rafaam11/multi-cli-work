import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SessionContextMenu, type SessionContextMenuProps } from "./SessionContextMenu";

afterEach(cleanup);

function renderMenu(overrides: Partial<SessionContextMenuProps> = {}) {
  const props: SessionContextMenuProps = {
    sessionLabel: "Claude",
    x: 10,
    y: 20,
    canResetName: true,
    hidden: false,
    onToggleHidden: vi.fn(),
    onRefresh: vi.fn(),
    onRename: vi.fn(),
    onResetName: vi.fn(),
    onReveal: vi.fn(),
    onCopyPath: vi.fn(),
    onExportLog: vi.fn(),
    onHandoff: vi.fn(),
    onFork: vi.fn(),
    onRemove: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<SessionContextMenu {...props} />);
  return props;
}

// `.context-menu button` is a grid whose first column is the 17px icon slot. A row without an icon
// drops its label into that slot, which breaks a Korean label into one character per line.
it("gives every item an icon so its label lands in the label column", () => {
  renderMenu();

  const items = screen.getAllByRole("menuitem");
  expect(items.map((item) => item.textContent)).toEqual(
    expect.arrayContaining(["다른 세션에 인계…", "대화 분기…", "폴더에서 열기"]),
  );
  for (const item of items) expect(item.firstElementChild?.tagName.toLowerCase()).toBe("svg");
});

it("opens the session's folder and closes the menu", () => {
  const props = renderMenu();

  fireEvent.click(screen.getByRole("menuitem", { name: "폴더에서 열기" }));

  expect(props.onReveal).toHaveBeenCalledTimes(1);
  expect(props.onClose).toHaveBeenCalledTimes(1);
});
