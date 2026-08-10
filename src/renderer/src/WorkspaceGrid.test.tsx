import type { TerminalSessionView } from "@shared/api-types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { layoutById } from "./grid-layouts";
import type { PaneContent } from "./pane-items";
import { SESSION_DRAG_TYPE } from "./session-drag";
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

function sessionSlot(session: TerminalSessionView): PaneContent {
  return { kind: "session", session };
}

function sessionsOf(slots: (PaneContent | null)[]): TerminalSessionView[] {
  return slots.flatMap((slot) => (slot?.kind === "session" ? [slot.session] : []));
}

function renderGrid(overrides: Partial<Parameters<typeof WorkspaceGrid>[0]> = {}) {
  const slots = overrides.slots ?? [sessionSlot(makeSession("session-1"))];
  const sessions = sessionsOf(slots);
  const props: Parameters<typeof WorkspaceGrid>[0] = {
    layout: layoutById("solo")!,
    slots,
    allSessions: sessions,
    agents: [],
    focusedPaneId: sessions[0]?.id ?? null,
    renamingSessionId: null,
    refreshRequests: {},
    refreshingSessionIds: new Set(),
    pendingAction: false,
    isProjectMissing: () => false,
    onAttached: vi.fn(),
    onRefreshComplete: vi.fn(),
    onError: vi.fn(),
    onRegisterCommands: vi.fn(),
    onTerminalFocused: vi.fn(),
    onFocusPane: vi.fn(),
    onResumeSession: vi.fn(),
    onRefreshSession: vi.fn(),
    onStopSession: vi.fn(),
    onClearSlot: vi.fn(),
    onDropPane: vi.fn(),
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
  it("draws the layout it is given and puts each pane in its own area", () => {
    const layout = layoutById("4-thirds-right")!;
    const sessions = [makeSession("session-1"), makeSession("session-2"), makeSession("session-3")];
    const { container } = renderGrid({ layout, slots: [...sessions.map(sessionSlot), null] });

    const grid = container.querySelector(".workspace-grid") as HTMLElement;
    expect(grid.style.gridTemplateAreas).toBe(layout.areas);
    expect(grid.style.gridTemplateColumns).toBe(layout.columns);
    expect(grid.getAttribute("data-slots")).toBe("4");
    expect([...container.querySelectorAll(".grid-pane")].map((pane) => (pane as HTMLElement).style.gridArea)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
    for (const session of sessions) expect(screen.getByTestId(`terminal-${session.id}`)).toBeTruthy();
  });

  it("leaves an open slot as a labelled drop target instead of collapsing the layout", () => {
    const { container } = renderGrid({
      layout: layoutById("2-col")!,
      slots: [null, sessionSlot(makeSession("session-2"))],
    });
    const empty = screen.getByLabelText("빈 슬롯 1 — 세션을 끌어다 놓기");
    expect((empty as HTMLElement).style.gridArea).toBe("s1");
    expect(container.querySelectorAll(".grid-pane")).toHaveLength(1);
  });

  it("reports the slot a dropped pane landed on, ignoring drags that carry no pane", () => {
    const { props } = renderGrid({
      layout: layoutById("2-col")!,
      slots: [sessionSlot(makeSession("session-1")), null],
    });
    const empty = screen.getByLabelText("빈 슬롯 2 — 세션을 끌어다 놓기");

    fireEvent.drop(empty, { dataTransfer: { types: ["text/plain"], getData: () => "project-atlas" } });
    expect(props.onDropPane).not.toHaveBeenCalled();

    fireEvent.drop(empty, {
      dataTransfer: { types: [SESSION_DRAG_TYPE], getData: () => "session-7" },
    });
    expect(props.onDropPane).toHaveBeenCalledWith(1, "session-7");
  });

  it("outlines the slot under the cursor while a pane drag is in flight", () => {
    const { container } = renderGrid({
      layout: layoutById("2-col")!,
      slots: [sessionSlot(makeSession("session-1")), null],
    });
    const empty = screen.getByLabelText("빈 슬롯 2 — 세션을 끌어다 놓기");

    fireEvent.dragOver(empty, { dataTransfer: { types: [SESSION_DRAG_TYPE] } });
    expect(empty.classList.contains("drop-target")).toBe(true);
    // The panes themselves stay put — only the outline moves during the drag.
    expect(container.querySelectorAll(".grid-pane")).toHaveLength(1);

    fireEvent.dragLeave(empty, { dataTransfer: { types: [SESSION_DRAG_TYPE] } });
    expect(empty.classList.contains("drop-target")).toBe(false);
  });

  it("hands the pane header over as a drag source so panes can trade slots", () => {
    renderGrid({ slots: [sessionSlot(makeSession("session-1"))] });
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByTitle("session-1").closest("header")!, {
      dataTransfer: { setData, types: [] },
    });
    expect(setData).toHaveBeenCalledWith(SESSION_DRAG_TYPE, "session-1");
  });

  it("marks only the focused pane and moves focus when another pane is pressed", () => {
    const sessions = [makeSession("session-1"), makeSession("session-2")];
    const { container, props } = renderGrid({
      layout: layoutById("2-col")!,
      slots: sessions.map(sessionSlot),
      focusedPaneId: "session-1",
    });
    const panes = container.querySelectorAll(".grid-pane");
    expect(panes[0]?.classList.contains("pane-focused")).toBe(true);
    expect(panes[1]?.classList.contains("pane-focused")).toBe(false);

    fireEvent.mouseDown(panes[1]!);
    expect(props.onFocusPane).toHaveBeenCalledWith("session-2");

    // Pressing the already focused pane must not re-fire a selection round-trip.
    fireEvent.mouseDown(panes[0]!);
    expect(props.onFocusPane).toHaveBeenCalledTimes(1);
  });

  it("gives a document the same slot, header and close button a terminal gets", () => {
    const { props } = renderGrid({
      layout: layoutById("2-col")!,
      slots: [
        sessionSlot(makeSession("session-1")),
        {
          kind: "document",
          document: {
            id: "file:project:atlas:README.md",
            kind: "file",
            label: "README.md",
            detail: "atlas",
            dirty: true,
          },
          content: <div data-testid="document-body" />,
        },
      ],
    });

    expect(screen.getByTestId("document-body")).toBeTruthy();
    expect(screen.getByLabelText("README.md")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "슬롯 비우기" })[1]!);
    expect(props.onClearSlot).toHaveBeenCalledWith(1);
  });

  it("empties the slot by index, renames inline, and offers resume for a finished session", () => {
    const sessions = [makeSession("session-1", { status: "exited" }), makeSession("session-2")];
    const { props, rerender } = renderGrid({ layout: layoutById("2-col")!, slots: sessions.map(sessionSlot) });

    fireEvent.click(screen.getAllByRole("button", { name: "슬롯 비우기" })[0]!);
    expect(props.onClearSlot).toHaveBeenCalledWith(0);

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
      slots: [sessionSlot(makeSession("session-1", { status: "error" }))],
      isProjectMissing: (projectId) => projectId === "project-atlas",
    });
    expect((screen.getByRole("button", { name: "세션 재개" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
