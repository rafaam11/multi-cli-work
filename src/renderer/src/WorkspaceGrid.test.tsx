import type { TerminalSessionView } from "@shared/api-types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceGrid } from "./WorkspaceGrid";

vi.mock("./TerminalPane", () => ({
  TerminalPane: ({ session }: { session: TerminalSessionView }) => (
    <div data-testid={`terminal-${session.id}`} />
  ),
}));

function makeSession(id: string, overrides: Partial<TerminalSessionView> = {}): TerminalSessionView {
  return {
    id,
    projectId: "project-atlas",
    tool: null,
    title: null,
    name: id,
    kind: "powershell",
    cwd: "C:\\work\\atlas",
    providerConversationId: null,
    interruptedByShutdown: false,
    status: "idle",
    pid: 4100,
    exitCode: null,
    createdAt: "2026-07-11T01:00:00.000Z",
    updatedAt: "2026-07-11T01:00:00.000Z",
    ...overrides,
  };
}

function renderGrid(overrides: Partial<Parameters<typeof WorkspaceGrid>[0]> = {}) {
  const sessions = overrides.sessions ?? [makeSession("session-1")];
  const props: Parameters<typeof WorkspaceGrid>[0] = {
    sessions,
    allSessions: sessions,
    agents: [],
    focusedSessionId: sessions[0]?.id ?? null,
    renamingSessionId: null,
    refreshRequests: {},
    refreshingSessionIds: new Set(),
    pendingAction: false,
    isProjectMissing: () => false,
    hiddenSessions: [],
    onAttached: vi.fn(),
    onRefreshComplete: vi.fn(),
    onError: vi.fn(),
    onRegisterCommands: vi.fn(),
    onTerminalFocused: vi.fn(),
    onFocusPane: vi.fn(),
    onResumeSession: vi.fn(),
    onRefreshSession: vi.fn(),
    onStopSession: vi.fn(),
    onClosePane: vi.fn(),
    onSwapSession: vi.fn(),
    onSessionContextMenu: vi.fn(),
    onStartRename: vi.fn(),
    onRenameSession: vi.fn(),
    onCancelRename: vi.fn(),
    ...overrides,
  };
  return { ...render(<WorkspaceGrid {...props} />), props };
}

afterEach(cleanup);

describe("WorkspaceGrid", () => {
  it("renders one pane per visible session and exposes the count for the layout", () => {
    for (const count of [1, 2, 4, 6]) {
      cleanup();
      const sessions = Array.from({ length: count }, (_, index) => makeSession(`session-${index + 1}`));
      const { container } = renderGrid({ sessions });
      expect(container.querySelector(".workspace-grid")?.getAttribute("data-panes")).toBe(String(count));
      expect(container.querySelectorAll(".grid-pane")).toHaveLength(count);
      for (const session of sessions) {
        expect(screen.getByTestId(`terminal-${session.id}`)).toBeTruthy();
      }
    }
  });

  it("marks only the focused pane and moves focus when another pane is pressed", () => {
    const sessions = [makeSession("session-1"), makeSession("session-2")];
    const { container, props } = renderGrid({ sessions, focusedSessionId: "session-1" });
    const panes = container.querySelectorAll(".grid-pane");
    expect(panes[0]?.classList.contains("pane-focused")).toBe(true);
    expect(panes[1]?.classList.contains("pane-focused")).toBe(false);

    fireEvent.mouseDown(panes[1]!);
    expect(props.onFocusPane).toHaveBeenCalledWith("session-2");

    // Pressing the already focused pane must not re-fire a selection round-trip.
    fireEvent.mouseDown(panes[0]!);
    expect(props.onFocusPane).toHaveBeenCalledTimes(1);
  });

  it("swaps a pane's session through the +N menu of off-screen sessions", () => {
    const { props } = renderGrid({
      sessions: [makeSession("session-1")],
      hiddenSessions: [
        { sessionId: "session-7", label: "일곱째", detail: "atlas" },
        { sessionId: "session-8", label: "여덟째", detail: null },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "화면 밖 세션 2개와 교체" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "일곱째" }));
    expect(props.onSwapSession).toHaveBeenCalledWith("session-1", "session-7");
  });

  it("closes only the pane, renames inline, and offers resume for a finished session", () => {
    const sessions = [
      makeSession("session-1", { status: "exited" }),
      makeSession("session-2"),
    ];
    const { props, rerender } = renderGrid({ sessions });

    fireEvent.click(screen.getAllByRole("button", { name: "패인 닫기" })[0]!);
    expect(props.onClosePane).toHaveBeenCalledWith("session-1");

    fireEvent.click(screen.getByRole("button", { name: "세션 재개" }));
    expect(props.onResumeSession).toHaveBeenCalledWith(sessions[0]);

    fireEvent.doubleClick(screen.getByTitle("session-2"));
    expect(props.onStartRename).toHaveBeenCalledWith("session-2");

    rerender(<WorkspaceGrid {...props} renamingSessionId="session-2" />);
    const input = screen.getByLabelText("세션 이름");
    fireEvent.change(input, { target: { value: "새 이름" } });
    fireEvent.submit(input.closest("form")!);
    expect(props.onRenameSession).toHaveBeenCalledWith("session-2", "새 이름");
  });

  it("blocks resume while the session's folder is missing", () => {
    renderGrid({
      sessions: [makeSession("session-1", { status: "error" })],
      isProjectMissing: (projectId) => projectId === "project-atlas",
    });
    expect((screen.getByRole("button", { name: "세션 재개" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
