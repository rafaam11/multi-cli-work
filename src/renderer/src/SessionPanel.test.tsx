import type { TerminalSessionView } from "@shared/api-types";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionPanel, type SessionPanelProps } from "./SessionPanel";
import type { SessionPanelItem } from "./session-panel";

function sessionFixture(id: string, waiting: boolean): TerminalSessionView {
  return {
    id,
    projectId: "project-atlas",
    tool: null,
    title: null,
    name: `세션 ${id}`,
    kind: "powershell",
    cwd: "C:\\work\\atlas",
    providerConversationId: null,
    interruptedByShutdown: false,
    status: waiting ? "awaiting-approval" : "idle",
    pid: 4100,
    exitCode: null,
    createdAt: "2026-08-11T01:00:00.000Z",
    updatedAt: "2026-08-11T01:00:00.000Z",
  };
}

function sessionItem(id: string, waiting: boolean): SessionPanelItem {
  return {
    kind: "session",
    id,
    label: `세션 ${id}`,
    place: "Sample Project",
    branch: null,
    projectId: "project-atlas",
    worktreeId: null,
    rank: waiting ? 0 : 3,
    session: sessionFixture(id, waiting),
    status: waiting ? "awaiting-approval" : "idle",
    agent: "powershell",
    tool: false,
    attention: waiting ? "approval" : null,
  };
}

const items: SessionPanelItem[] = [sessionItem("session-1", true), sessionItem("session-2", false)];

function renderPanel(overrides: Partial<SessionPanelProps> = {}) {
  const props: SessionPanelProps = {
    items,
    scopeTarget: { kind: "none" },
    scope: "all",
    onChangeScope: vi.fn(),
    open: true,
    onToggleOpen: vi.fn(),
    selected: false,
    dropTarget: false,
    onSelectWorkspace: vi.fn(),
    onSelectPane: vi.fn(),
    onMovePaneToHidden: vi.fn(),
    agents: [],
    focusedPaneId: null,
    onScreenPaneIds: new Set<string>(),
    renamingSessionId: null,
    onSessionContextMenu: vi.fn(),
    onRenameSession: vi.fn(),
    onCancelRename: vi.fn(),
    paneDragProps: () => ({ draggable: false, onDragStart: vi.fn(), onDragEnd: vi.fn() }),
    paneDropClass: () => "",
    paneDropProps: () => ({ onDragOver: vi.fn(), onDragLeave: vi.fn(), onDrop: vi.fn() }),
    headingDropProps: { onDragOver: vi.fn(), onDragLeave: vi.fn(), onDrop: vi.fn() },
    ...overrides,
  };
  return { ...render(<SessionPanel {...props} />), props };
}

afterEach(() => {
  cleanup();
});

describe("SessionPanel", () => {
  it("대기 배지가 제목 버튼 안에 있어 배지를 눌러도 작업공간이 열린다", () => {
    const { props } = renderPanel();
    const title = screen.getByRole("button", { name: "세션 작업공간 열기 (패인 2개)" });
    const badge = within(title).getByText("대기 1");

    fireEvent.click(badge);

    expect(props.onSelectWorkspace).toHaveBeenCalledTimes(1);
  });

  it("접기 토글과 범위 버튼은 제목 버튼 밖에 남는다", () => {
    renderPanel();
    const title = screen.getByRole("button", { name: "세션 작업공간 열기 (패인 2개)" });

    expect(title.querySelector(".tree-toggle")).toBeNull();
    expect(title.querySelector(".session-panel-scope")).toBeNull();

    // jsdom엔 레이아웃이 없으니 실제 폭(제목이 남는 폭을 먹는지)은 e2e가 잰다 — 여기서는 세 요소가
    // 헤더의 직계 자식으로 tree-toggle → session-panel-title → session-panel-scope 순서인지만 본다.
    const heading = title.closest(".session-panel-heading")!;
    const childClassLists = Array.from(heading.children).map((child) => child.className);
    expect(childClassLists[0]).toContain("tree-toggle");
    expect(childClassLists[1]).toContain("session-panel-title");
    expect(childClassLists[childClassLists.length - 1]).toContain("session-panel-scope");
  });

  it("토글과 범위 버튼은 각자만 부른다", () => {
    const { props } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "세션 패널 접기" }));
    expect(props.onToggleOpen).toHaveBeenCalledTimes(1);
    expect(props.onSelectWorkspace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "전체" }));
    expect(props.onChangeScope).toHaveBeenCalledWith("all");
    expect(props.onSelectWorkspace).not.toHaveBeenCalled();
    expect(props.onToggleOpen).toHaveBeenCalledTimes(1);
  });

  it("접근성 이름에 대기 수가 새지 않는다", () => {
    renderPanel();
    const title = screen.getByRole("button", { name: "세션 작업공간 열기 (패인 2개)" });

    expect(title).toHaveAccessibleName("세션 작업공간 열기 (패인 2개)");
  });
});
