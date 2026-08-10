import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaneTabBar, type ViewTab } from "./PaneTabBar";
import { SESSION_DRAG_TYPE } from "./session-drag";

function sessionTab(id: string, overrides: Partial<Extract<ViewTab, { kind: "session" }>> = {}): ViewTab {
  return {
    kind: "session",
    id,
    label: id,
    status: "idle",
    agent: "powershell",
    detail: null,
    onScreen: true,
    ...overrides,
  };
}

function documentTab(id: string, overrides: Partial<Extract<ViewTab, { kind: "document" }>> = {}): ViewTab {
  return {
    kind: "document",
    id,
    label: id,
    document: "file",
    dirty: false,
    detail: null,
    onScreen: true,
    ...overrides,
  };
}

function renderBar(overrides: Partial<Parameters<typeof PaneTabBar>[0]> = {}) {
  const props: Parameters<typeof PaneTabBar>[0] = {
    tabs: [sessionTab("session-1"), sessionTab("session-2")],
    agents: [],
    activePaneId: "session-1",
    page: 0,
    pageCount: 1,
    onSelect: vi.fn(),
    onPageChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<PaneTabBar {...props} />), props };
}

afterEach(cleanup);

describe("PaneTabBar", () => {
  it("keeps the order it is handed rather than sorting by status", () => {
    const { container } = renderBar({
      tabs: [
        sessionTab("session-1", { label: "먼저", status: "idle" }),
        sessionTab("session-2", { label: "나중", status: "working" }),
      ],
    });
    expect([...container.querySelectorAll(".session-tab-label")].map((label) => label.textContent)).toEqual([
      "먼저",
      "나중",
    ]);
  });

  it("marks the focused pane as the current tab", () => {
    renderBar({ activePaneId: "session-2" });
    expect(screen.getByRole("tab", { name: /session-2/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /session-1/ }).getAttribute("aria-selected")).toBe("false");
  });

  it("dims a pane that sits on another page", () => {
    const { container } = renderBar({ tabs: [sessionTab("session-1"), sessionTab("session-2", { onScreen: false })] });
    const tabs = container.querySelectorAll(".session-tab");
    expect(tabs[0]?.classList.contains("offscreen")).toBe(false);
    expect(tabs[1]?.classList.contains("offscreen")).toBe(true);
  });

  it("reports the pane a tab stands for when it is pressed", () => {
    const { props } = renderBar();
    fireEvent.click(screen.getByRole("tab", { name: /session-2/ }));
    expect(props.onSelect).toHaveBeenCalledWith("session-2");
  });

  it("shows the folder only when the caller gives one, which is how a workspace tells them apart", () => {
    cleanup();
    renderBar({ tabs: [sessionTab("session-1", { detail: "atlas" })] });
    expect(screen.getByText("atlas")).toBeTruthy();
  });

  it("lists an open document beside the terminals, marking unsaved edits", () => {
    renderBar({
      tabs: [sessionTab("session-1"), documentTab("file:project:atlas:README.md", { label: "README.md", dirty: true })],
    });
    const tab = screen.getByRole("tab", { name: /README\.md/ });
    expect(tab.querySelector(".status-dot")).toBeNull();
    expect(tab.querySelector(".pane-dirty")).not.toBeNull();
  });

  it("carries the pane id in a type of its own so drop targets can tell it from a folder drag", () => {
    renderBar();
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByRole("tab", { name: /session-2/ }), {
      dataTransfer: { setData, types: [] },
    });
    expect(setData).toHaveBeenCalledWith(SESSION_DRAG_TYPE, "session-2");
    expect(setData).toHaveBeenCalledWith("text/plain", "session-2");
  });

  it("hides the pager while everything fits on one page", () => {
    renderBar({ pageCount: 1 });
    expect(screen.queryByRole("button", { name: "다음 페이지" })).toBeNull();
  });

  it("pages through the slots, stopping at both ends", () => {
    const { props, rerender } = renderBar({ page: 0, pageCount: 3 });
    expect((screen.getByRole("button", { name: "이전 페이지" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("1/3")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
    expect(props.onPageChange).toHaveBeenCalledWith(1);

    rerender(<PaneTabBar {...props} page={2} pageCount={3} />);
    expect((screen.getByRole("button", { name: "다음 페이지" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "이전 페이지" }));
    expect(props.onPageChange).toHaveBeenCalledWith(1);
  });

  it("draws nothing when the view holds no panes", () => {
    const { container } = renderBar({ tabs: [] });
    expect(container.querySelector(".session-tab-bar")).toBeNull();
  });
});
