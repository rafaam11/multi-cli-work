import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TerminalContextMenu } from "./TerminalContextMenu";

afterEach(cleanup);

function renderMenu(hasSelection: boolean) {
  const onAction = vi.fn();
  const onClose = vi.fn();
  render(<TerminalContextMenu x={40} y={60} hasSelection={hasSelection} onAction={onAction} onClose={onClose} />);
  return { onAction, onClose };
}

describe("TerminalContextMenu", () => {
  it("carries the old 편집 menu, named and keyed from the command registry", () => {
    renderMenu(true);
    const menu = screen.getByRole("menu", { name: "터미널" });
    const rows = [...menu.querySelectorAll("button")].map((button) => button.textContent);
    expect(rows).toEqual(["복사Ctrl+Shift+C", "붙여넣기Ctrl+V", "모두 선택", "찾기Ctrl+F", "화면 지우기"]);
  });

  it("offers 복사 only with a selection to copy", () => {
    renderMenu(false);
    expect(screen.getByRole("menuitem", { name: /복사/ })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /붙여넣기/ })).toBeEnabled();
  });

  it("closes before it runs the command, and closes on Escape or a click elsewhere", () => {
    const { onAction, onClose } = renderMenu(true);
    fireEvent.click(screen.getByRole("menuitem", { name: /붙여넣기/ }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onAction).toHaveBeenCalledExactlyOnceWith("edit.paste");

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("keeps the press inside the menu from taking the terminal's selection", () => {
    renderMenu(true);
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    screen.getByRole("menuitem", { name: /복사/ }).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
