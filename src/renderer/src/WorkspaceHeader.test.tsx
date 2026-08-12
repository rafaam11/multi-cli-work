import type { TerminalSessionView } from "@shared/api-types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHeader } from "./WorkspaceHeader";

const session: TerminalSessionView = {
  id: "session-1",
  projectId: "project-atlas",
  tool: null,
  title: null,
  name: "Echo Agent",
  kind: "powershell",
  cwd: "C:\\work\\atlas",
  providerConversationId: null,
  interruptedByShutdown: false,
  status: "idle",
  pid: 4100,
  exitCode: null,
  createdAt: "2026-08-11T01:00:00.000Z",
  updatedAt: "2026-08-11T01:00:00.000Z",
};

function renderHeader(overrides: Partial<Parameters<typeof WorkspaceHeader>[0]> = {}) {
  const props: Parameters<typeof WorkspaceHeader>[0] = {
    workspace: null,
    layout: { layoutId: "auto", paneCount: 2, onSelect: vi.fn() },
    pages: null,
    selectedProject: null,
    selectedSession: null,
    selectedSessionLabel: null,
    focusedSession: null,
    onRemoveSession: vi.fn(),
    projectMissing: false,
    agents: [],
    pendingAction: false,
    readOnly: false,
    detailActive: false,
    onOpenDetail: vi.fn(),
    onStartSession: vi.fn(),
    onRelinkProject: vi.fn(),
    ...overrides,
  };
  const result = render(<WorkspaceHeader {...props} />);
  return { ...result, props };
}

afterEach(cleanup);

describe("WorkspaceHeader", () => {
  /**
   * The picker sits in the header so the grid keeps the row it used to spend on it. That only works
   * if the header is where it renders — and `layout: null` is the caller's way of saying this
   * surface has no arrangement at all (the 홈 and 상세 pages), which must leave the row empty.
   */
  it("carries the layout picker beside the launchers, and drops it where there is no arrangement", () => {
    const { rerender, props } = renderHeader();
    const picker = screen.getByRole("radiogroup", { name: "레이아웃 선택" });
    expect(picker.closest(".workspace-actions")).toBeTruthy();

    rerender(<WorkspaceHeader {...props} layout={null} />);
    expect(screen.queryByRole("radiogroup", { name: "레이아웃 선택" })).toBeNull();
  });

  /**
   * A folder with no sessions yet still carries a layout of its own, so the row stays — arranging
   * before the first session is the whole point, and 자동 must draw a preview at a count of zero
   * rather than blowing up.
   */
  it("keeps the picker on a folder that holds no panes at all", () => {
    renderHeader({ layout: { layoutId: "auto", paneCount: 0, onSelect: vi.fn() } });
    expect(screen.getByRole("radiogroup", { name: "레이아웃 선택" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "자동" })).toBeTruthy();
  });

  it("reports the layout the user picked", () => {
    const { props } = renderHeader();
    fireEvent.click(screen.getByRole("radio", { name: "2열" }));
    expect(props.layout?.onSelect).toHaveBeenCalledWith("cols:1-1");
  });

  /** A shelf holds panes from several folders, so it has no folder controls — but it has a grid. */
  it("keeps the picker on a shelf, where every other control steps aside", () => {
    renderHeader({ workspace: { kind: "active", paneCount: 2, folderCount: 2 } });
    expect(screen.getByRole("radiogroup", { name: "레이아웃 선택" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "폴더 상세" })).toBeNull();
    expect(screen.getByText("작업공간")).toBeTruthy();
  });

  it("names 숨김 as itself, and says what an empty one is waiting for", () => {
    const { rerender, props } = renderHeader({ workspace: { kind: "hidden", paneCount: 0, folderCount: 0 } });
    expect(screen.getByText("숨김")).toBeTruthy();
    expect(screen.getByText("숨긴 세션이나 문서가 없습니다")).toBeTruthy();

    rerender(<WorkspaceHeader {...props} workspace={{ kind: "active", paneCount: 0, folderCount: 0 }} />);
    expect(screen.getByText("작업공간")).toBeTruthy();
    expect(screen.getByText("실행 중인 세션이나 열린 문서가 없습니다")).toBeTruthy();
  });

  /**
   * Deleting a session was reachable only by right-clicking a pane header. The header button names
   * the session it would delete, because on a grid nothing else says which one that is.
   */
  it("offers 제거 for the focused pane's session, naming it", () => {
    const { props } = renderHeader({ focusedSession: { session, label: "Echo Agent" } });
    fireEvent.click(screen.getByRole("button", { name: "Echo Agent 세션 제거" }));
    expect(props.onRemoveSession).toHaveBeenCalledWith(session);
  });

  it("offers 제거 on a shelf too, where the focus is the only thing that says which session", () => {
    renderHeader({
      workspace: { kind: "active", paneCount: 2, folderCount: 2 },
      focusedSession: { session, label: "Echo Agent" },
    });
    expect(screen.getByRole("button", { name: "Echo Agent 세션 제거" })).toBeTruthy();
  });

  it("has nothing to delete when the focused pane is a document", () => {
    renderHeader({ focusedSession: null });
    expect(screen.queryByRole("button", { name: /세션 제거/ })).toBeNull();
  });
});
