import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHeader } from "./WorkspaceHeader";

function agentFixture(id: string, label: string, available: boolean): AgentView {
  return {
    id,
    label,
    commands: [id],
    args: [],
    newSessionArgs: [],
    resumeArgs: [],
    conversationId: "none",
    statusAdapter: "signals",
    titleSource: "none",
    shiftEnter: "enter",
    icon: id,
    accentColor: null,
    builtin: true,
    available,
  };
}

const agents: AgentView[] = [agentFixture("powershell", "PowerShell", true), agentFixture("codex", "Codex", false)];

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
    refreshAll: null,
    selectedProject: null,
    selectedSession: null,
    selectedSessionLabel: null,
    focusedSession: null,
    projectMissing: false,
    agents: [],
    pendingAction: false,
    detailActive: false,
    onOpenDetail: vi.fn(),
    onStartSession: vi.fn(),
    onRequestNewSession: vi.fn(),
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
   * 제거 is on every pane header, and 폴더 다시 연결 is the missing-folder notice's button, the 파일
   * menu's and the folder's right-click menu's. The header carried a second copy of each.
   */
  it("leaves 제거 to the pane headers and 다시 연결 to the missing-folder notice", () => {
    renderHeader({
      selectedProject: { id: "p1", rootPath: "C:\\work\\atlas", displayName: "Atlas" } as SharedProject,
      selectedSession: session,
      selectedSessionLabel: "Echo Agent",
      focusedSession: { session, label: "Echo Agent", launchDisabledReason: null },
      projectMissing: true,
    });
    expect(screen.queryByRole("button", { name: /세션 제거/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /다시 연결/ })).toBeNull();
  });

  /**
   * Refreshing rebuilds every terminal against the size it now has, which is a property of the window
   * rather than of any one session. One button here does what a button on each pane header used to.
   */
  it("redraws every pane on screen from one button, and says how many that is", () => {
    const onRefresh = vi.fn();
    renderHeader({ refreshAll: { count: 3, busy: false, onRefresh } });
    const button = screen.getByRole("button", { name: "화면 새로고침" });
    expect(button).toHaveAttribute("title", "화면에 보이는 세션 3개 새로고침");

    fireEvent.click(button);
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("holds the refresh button still while one is running, and on a surface with nothing to redraw", () => {
    const { rerender, props } = renderHeader({ refreshAll: { count: 2, busy: true, onRefresh: vi.fn() } });
    expect(screen.getByRole("button", { name: "화면 새로고침" })).toBeDisabled();

    rerender(<WorkspaceHeader {...props} refreshAll={{ count: 0, busy: false, onRefresh: vi.fn() }} />);
    expect(screen.getByRole("button", { name: "화면 새로고침" })).toBeDisabled();

    // A surface with no grid at all (홈, 상세) has no panes to speak of, so the button steps aside.
    rerender(<WorkspaceHeader {...props} refreshAll={null} />);
    expect(screen.queryByRole("button", { name: "화면 새로고침" })).toBeNull();
  });

  /**
   * A shelf has no folder of its own, so "here" is whichever pane holds the focus. The launchers follow
   * it there and say so, since on a grid of terminals nothing else names where a session would land.
   */
  it("aims the launchers at the focused pane on a shelf, naming where the session lands", () => {
    const { props } = renderHeader({
      workspace: { kind: "active", paneCount: 2, folderCount: 2 },
      focusedSession: { session, label: "Echo Agent", launchDisabledReason: null },
      agents,
    });
    const button = screen.getByRole("button", { name: "새 PowerShell 세션" });
    expect(button).toHaveAttribute("title", "Echo Agent와 같은 경로에서 PowerShell 시작");

    fireEvent.click(button);
    expect(props.onStartSession).toHaveBeenCalledWith("powershell");
    // A missing executable is still a missing executable, whichever surface the launcher rides on.
    expect(screen.getByRole("button", { name: "새 Codex 세션" })).toBeDisabled();
  });

  it("keeps the launchers off a shelf with no focused session, and explains a path that cannot start one", () => {
    const { rerender, props } = renderHeader({
      workspace: { kind: "active", paneCount: 1, folderCount: 1 },
      agents,
    });
    expect(screen.queryByRole("button", { name: "새 PowerShell 세션" })).toBeNull();

    rerender(
      <WorkspaceHeader
        {...props}
        focusedSession={{ session, label: "Echo Agent", launchDisabledReason: "폴더를 다시 연결하세요" }}
      />,
    );
    const button = screen.getByRole("button", { name: "새 PowerShell 세션" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "폴더를 다시 연결하세요");
  });

  /**
   * 자동 closes every gap in the arrangement, so it never shows an empty slot to press — and pressing
   * one is the only other way to the recent-folders list. On that layout this button is the way in.
   */
  it("offers 새 세션 on 자동 only, and opens the list under the button", () => {
    const { rerender, props } = renderHeader({ workspace: { kind: "active", paneCount: 2, folderCount: 2 } });
    const button = screen.getByRole("button", { name: "최근 폴더에서 새 세션" });

    fireEvent.click(button);
    expect(props.onRequestNewSession).toHaveBeenCalledWith({ x: expect.any(Number), y: expect.any(Number) });

    // A preset layout draws its own empty slots, which already open the list.
    rerender(<WorkspaceHeader {...props} layout={{ layoutId: "cols:1-1", paneCount: 2, onSelect: vi.fn() }} />);
    expect(screen.queryByRole("button", { name: "최근 폴더에서 새 세션" })).toBeNull();

    rerender(<WorkspaceHeader {...props} layout={null} />);
    expect(screen.queryByRole("button", { name: "최근 폴더에서 새 세션" })).toBeNull();
  });
});
