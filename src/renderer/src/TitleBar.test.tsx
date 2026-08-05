import type { MultiCliWorkApi, WindowChromeState } from "@shared/api-types";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TitleBar } from "./TitleBar";
import type { TitleBarMenu } from "./title-bar-menu";

function createWindowApi(initial: WindowChromeState = { maximized: false, fullScreen: false }) {
  const listeners = new Set<(state: WindowChromeState) => void>();
  const windowApi: MultiCliWorkApi["window"] = {
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    state: vi.fn().mockResolvedValue(initial),
    toggleFullScreen: vi.fn().mockResolvedValue(undefined),
    toggleDevTools: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
    zoom: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    onStateChange: vi.fn((listener: (state: WindowChromeState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  window.multiCliWork = { window: windowApi } as unknown as MultiCliWorkApi;
  return {
    windowApi,
    emit(state: WindowChromeState) {
      act(() => {
        for (const listener of listeners) listener(state);
      });
    },
  };
}

const menus: TitleBarMenu[] = [
  {
    id: "file",
    label: "파일",
    entries: [
      { kind: "item", id: "file.add-folder", label: "폴더 추가" },
      { kind: "separator" },
      { kind: "item", id: "file.save", label: "파일 저장", shortcut: "Ctrl+S", disabled: true },
      { kind: "item", id: "file.quit", label: "종료" },
    ],
  },
  {
    id: "session",
    label: "세션",
    entries: [
      {
        kind: "submenu",
        id: "session.new",
        label: "새 세션",
        items: [
          { kind: "item", id: "session.new:claude", label: "Claude Code" },
          { kind: "item", id: "session.new:codex", label: "Codex", disabled: true },
        ],
      },
      { kind: "item", id: "session.stop", label: "중지" },
    ],
  },
];

function renderTitleBar(overrides?: Partial<Parameters<typeof TitleBar>[0]>) {
  const onAction = vi.fn();
  const onQuickOpen = vi.fn();
  render(
    <TitleBar
      menus={menus}
      onAction={onAction}
      workProjectName="스마트팜"
      folderName="atlas"
      attention={null}
      onQuickOpen={onQuickOpen}
      {...overrides}
    />,
  );
  return { onAction, onQuickOpen };
}

afterEach(cleanup);

describe("title bar", () => {
  it("opens a menu, runs an item, and closes itself again", async () => {
    createWindowApi();
    const { onAction } = renderTitleBar();

    fireEvent.click(screen.getByRole("menuitem", { name: "파일" }));
    const dropdown = await screen.findByRole("menu", { name: "파일" });
    expect(within(dropdown).getByRole("menuitem", { name: /파일 저장/ })).toBeDisabled();

    fireEvent.click(within(dropdown).getByRole("menuitem", { name: "폴더 추가" }));

    expect(onAction).toHaveBeenCalledExactlyOnceWith("file.add-folder");
    expect(screen.queryByRole("menu", { name: "파일" })).not.toBeInTheDocument();
  });

  it("switches menus on hover once one is open, and never before", () => {
    createWindowApi();
    renderTitleBar();

    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "세션" }));
    expect(screen.queryByRole("menu", { name: "세션" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "파일" }));
    fireEvent.mouseEnter(screen.getByRole("menuitem", { name: "세션" }));

    expect(screen.getByRole("menu", { name: "세션" })).toBeInTheDocument();
    expect(screen.queryByRole("menu", { name: "파일" })).not.toBeInTheDocument();
  });

  it("walks the open menu with the arrow keys and closes it with Escape", () => {
    createWindowApi();
    renderTitleBar();

    const fileButton = screen.getByRole("menuitem", { name: "파일" });
    fireEvent.click(fileButton);
    fireEvent.keyDown(fileButton, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "폴더 추가" })).toHaveFocus();

    // 파일 저장 is disabled, so the next stop is 종료.
    fireEvent.keyDown(fileButton, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "종료" })).toHaveFocus();

    // ArrowRight steps to the next top-level menu, as in any menu bar.
    fireEvent.keyDown(fileButton, { key: "ArrowRight" });
    expect(screen.getByRole("menu", { name: "세션" })).toBeInTheDocument();

    fireEvent.keyDown(fileButton, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "세션" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "세션" })).toHaveFocus();
  });

  it("opens a submenu and reports the item that was picked inside it", async () => {
    createWindowApi();
    const { onAction } = renderTitleBar();

    fireEvent.click(screen.getByRole("menuitem", { name: "세션" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /새 세션/ }));

    const submenu = await screen.findByRole("menu", { name: "새 세션" });
    expect(within(submenu).getByRole("menuitem", { name: "Codex" })).toBeDisabled();

    fireEvent.click(within(submenu).getByRole("menuitem", { name: "Claude Code" }));
    expect(onAction).toHaveBeenCalledExactlyOnceWith("session.new:claude");
  });

  it("names the folder in the command centre and opens quick open when it is pressed", () => {
    createWindowApi();
    const { onQuickOpen } = renderTitleBar();

    fireEvent.click(screen.getByRole("button", { name: "빠른 열기" }));

    expect(screen.getByText("스마트팜 / atlas")).toBeInTheDocument();
    expect(onQuickOpen).toHaveBeenCalledOnce();
  });

  it("marks approval as more urgent than plain input next to the command centre", () => {
    createWindowApi();
    renderTitleBar({ attention: "approval" });

    expect(screen.getByRole("status", { name: "승인을 기다리는 세션이 있습니다" })).toHaveTextContent("!");
  });

  it("drives the native window and follows a maximize the app did not ask for", async () => {
    const harness = createWindowApi();
    renderTitleBar();

    fireEvent.click(screen.getByRole("button", { name: "최소화" }));
    fireEvent.click(screen.getByRole("button", { name: "최대화" }));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));

    expect(harness.windowApi.minimize).toHaveBeenCalledOnce();
    expect(harness.windowApi.toggleMaximize).toHaveBeenCalledOnce();
    expect(harness.windowApi.close).toHaveBeenCalledOnce();

    await waitFor(() => expect(harness.windowApi.onStateChange).toHaveBeenCalled());
    harness.emit({ maximized: true, fullScreen: false });

    expect(screen.getByRole("button", { name: "이전 크기로 복원" })).toBeInTheDocument();
  });
});
