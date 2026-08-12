import type { TerminalSessionView } from "@shared/api-types";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { layoutById } from "./grid-layouts";
import type { PaneContext } from "./pane-context";
import { paneContentId, type PaneContent } from "./pane-items";
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

function paneContext(overrides: Partial<PaneContext> = {}): PaneContext {
  return {
    folder: "atlas",
    branch: null,
    workProject: null,
    accentClass: null,
    title: "atlas",
    tool: false,
    ...overrides,
  };
}

/** Every pane on screen knows where it lives, the way App's map always answers for an open pane. */
function contextsFor(slots: (PaneContent | null)[]): Map<string, PaneContext> {
  const map = new Map<string, PaneContext>();
  for (const slot of slots) {
    if (slot) map.set(paneContentId(slot), paneContext());
  }
  return map;
}

function renderGrid(overrides: Partial<Parameters<typeof WorkspaceGrid>[0]> = {}) {
  const slots = overrides.slots ?? [sessionSlot(makeSession("session-1"))];
  const sessions = sessionsOf(slots);
  const props: Parameters<typeof WorkspaceGrid>[0] = {
    layout: layoutById("cols:1")!,
    slots,
    allSessions: sessions,
    paneContexts: contextsFor(slots),
    agents: [],
    focusedPaneId: sessions[0]?.id ?? null,
    renamingSessionId: null,
    refreshRequests: {},
    refreshingSessionIds: new Set(),
    pendingAction: false,
    clearAction: null,
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
    onSplitColumn: vi.fn(),
    onMergeColumn: vi.fn(),
    onRemoveSession: vi.fn(),
    onDropPane: vi.fn(),
    onSnapPane: vi.fn(),
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
    const layout = layoutById("cols:1-1-2")!;
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
      layout: layoutById("cols:1-1")!,
      slots: [null, sessionSlot(makeSession("session-2"))],
    });
    const empty = screen.getByLabelText("빈 슬롯 1 — 세션을 끌어다 놓기");
    expect((empty as HTMLElement).style.gridArea).toBe("s1");
    expect(container.querySelectorAll(".grid-pane")).toHaveLength(1);
  });

  it("reports the slot a dropped pane landed on, ignoring drags that carry no pane", () => {
    const { props } = renderGrid({
      layout: layoutById("cols:1-1")!,
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
      layout: layoutById("cols:1-1")!,
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

  /**
   * jsdom lays nothing out, so the grid is told how big it is — the zone maths itself is covered in
   * snap-zones.test.ts; what matters here is that the grid reads the cursor against its own box.
   */
  function gridSized(container: HTMLElement, width = 1000, height = 600): HTMLElement {
    const grid = container.querySelector(".workspace-grid") as HTMLElement;
    grid.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    return grid;
  }

  /**
   * jsdom has no DragEvent, so fireEvent falls back to a plain Event and drops clientX/clientY with
   * it — and a snap is nothing but a cursor position. A MouseEvent under the drag's name carries
   * both, and the drag payload is attached the way the platform hands it over.
   */
  function dragAt(element: HTMLElement, type: "dragover" | "drop", x: number, y: number, paneId = "session-7") {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(event, "dataTransfer", {
      value: { types: [SESSION_DRAG_TYPE], dropEffect: "none", getData: () => paneId },
    });
    fireEvent(element, event);
  }

  it("previews the region an edge drop would fill, and snaps the pane into it", () => {
    const { container, props } = renderGrid({
      layout: layoutById("cols:1-1")!,
      slots: [sessionSlot(makeSession("session-1")), null],
    });
    const grid = gridSized(container);
    const empty = screen.getByLabelText("빈 슬롯 2 — 세션을 끌어다 놓기");

    dragAt(empty, "dragover", 4, 4);
    const preview = grid.querySelector(".snap-preview") as HTMLElement;
    expect(preview.getAttribute("data-zone")).toBe("top-left");
    expect(preview.style.width).toBe("50%");
    // The edge owns the cursor, so the slot under it stops offering itself.
    expect(empty.classList.contains("drop-target")).toBe(false);
    // And still nothing has moved: the drop is the one rearrangement.
    expect(container.querySelectorAll(".grid-pane")).toHaveLength(1);

    dragAt(empty, "drop", 4, 4);
    expect(props.onDropPane).not.toHaveBeenCalled();
    expect(props.onSnapPane).toHaveBeenCalledWith(
      expect.objectContaining({ id: "top-left", layoutId: "cols:2-2", slotIndex: 0 }),
      "session-7",
    );
  });

  it("leaves the middle of the grid to the ordinary slot-for-slot drop", () => {
    const { container, props } = renderGrid({
      layout: layoutById("cols:1-1")!,
      slots: [sessionSlot(makeSession("session-1")), null],
    });
    gridSized(container);
    const empty = screen.getByLabelText("빈 슬롯 2 — 세션을 끌어다 놓기");

    dragAt(empty, "dragover", 500, 300);
    expect(container.querySelector(".snap-preview")).toBeNull();
    expect(empty.classList.contains("drop-target")).toBe(true);

    dragAt(empty, "drop", 500, 300);
    expect(props.onSnapPane).not.toHaveBeenCalled();
    expect(props.onDropPane).toHaveBeenCalledWith(1, "session-7");
  });

  it("clears the snap preview when the drag leaves the grid", () => {
    const { container } = renderGrid({
      layout: layoutById("cols:1-1")!,
      slots: [sessionSlot(makeSession("session-1")), null],
    });
    const grid = gridSized(container);

    dragAt(grid, "dragover", 500, 4);
    expect(container.querySelector(".snap-preview")?.getAttribute("data-zone")).toBe("top");

    fireEvent.dragLeave(grid, { dataTransfer: { types: [SESSION_DRAG_TYPE] }, relatedTarget: document.body });
    expect(container.querySelector(".snap-preview")).toBeNull();
  });

  /** ✕ and 🗑 sit next to each other, so the test pins which one keeps the session alive. */
  it("tells emptying a slot apart from deleting the session behind it", () => {
    const target = makeSession("session-1");
    const { props } = renderGrid({ slots: [sessionSlot(target)] });

    fireEvent.click(screen.getByRole("button", { name: "슬롯 비우기" }));
    expect(props.onClearSlot).toHaveBeenCalledWith(0);
    expect(props.onRemoveSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "세션 제거" }));
    expect(props.onRemoveSession).toHaveBeenCalledWith(target);
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
      layout: layoutById("cols:1-1")!,
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
      layout: layoutById("cols:1-1")!,
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
            owner: { kind: "project", id: "project-atlas" },
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
    const { props, rerender } = renderGrid({ layout: layoutById("cols:1-1")!, slots: sessions.map(sessionSlot) });

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

  it("splits the column a pane's own button names, and only that column", () => {
    const sessions = [makeSession("session-1"), makeSession("session-2"), makeSession("session-3")];
    const { props } = renderGrid({
      layout: layoutById("cols:1-1-1")!,
      slots: sessions.map(sessionSlot),
    });

    const buttons = screen.getAllByRole("button", { name: "열 세로분할" });
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[1]!);
    expect(props.onSplitColumn).toHaveBeenCalledWith(1);
    expect(props.onMergeColumn).not.toHaveBeenCalled();
  });

  it("offers the merge instead once a column holds two rows, from either of its panes", () => {
    const sessions = [makeSession("session-1"), makeSession("session-2"), makeSession("session-3")];
    const { props } = renderGrid({
      layout: layoutById("cols:1-2-1")!,
      slots: [...sessions.map(sessionSlot), null],
    });

    // Only the middle column's pair is stacked, so only those two say 해제.
    expect(screen.getAllByRole("button", { name: "열 세로분할" })).toHaveLength(1);
    const merges = screen.getAllByRole("button", { name: "열 분할 해제" });
    expect(merges).toHaveLength(2);

    fireEvent.click(merges[1]!);
    expect(props.onMergeColumn).toHaveBeenCalledWith(2);
    expect(props.onSplitColumn).not.toHaveBeenCalled();
  });

  /** A column with nothing in it is not one anybody wants to split further. */
  it("leaves an empty slot without a split button", () => {
    renderGrid({ layout: layoutById("cols:1-1")!, slots: [sessionSlot(makeSession("session-1")), null] });
    expect(screen.getAllByRole("button", { name: "열 세로분할" })).toHaveLength(1);
  });

  it("gives a document pane the same button — splitting a column is not a terminal's privilege", () => {
    const { props } = renderGrid({
      layout: layoutById("cols:1-1")!,
      slots: [
        sessionSlot(makeSession("session-1")),
        {
          kind: "document",
          document: {
            id: "file:project:atlas:README.md",
            kind: "file",
            label: "README.md",
            detail: "atlas",
            dirty: false,
            owner: { kind: "project", id: "project-atlas" },
          },
          content: <div />,
        },
      ],
    });

    fireEvent.click(screen.getAllByRole("button", { name: "열 세로분할" })[1]!);
    expect(props.onSplitColumn).toHaveBeenCalledWith(1);
  });

  /**
   * Twelve is the cap, and with two rows per column it is reached exactly when every column is
   * already split — so a full page offers merges rather than a row of dead buttons. The disabled
   * state the button can render is the guard for a taller column, not for this arrangement.
   */
  it("offers no split at all on a full twelve-pane page", () => {
    const sessions = Array.from({ length: 12 }, (_, index) => makeSession(`session-${index}`));
    renderGrid({ layout: layoutById("cols:2-2-2-2-2-2")!, slots: sessions.map(sessionSlot) });

    expect(screen.queryAllByRole("button", { name: "열 세로분할" })).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "열 분할 해제" })).toHaveLength(12);
  });

  it("blocks resume while the session's folder is missing", () => {
    renderGrid({
      slots: [sessionSlot(makeSession("session-1", { status: "error" }))],
      isProjectMissing: (projectId) => projectId === "project-atlas",
    });
    expect((screen.getByRole("button", { name: "세션 재개" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens a session header with the folder, branch and work project the pane belongs to", () => {
    const { container } = renderGrid({
      paneContexts: new Map([
        [
          "session-1",
          paneContext({
            branch: "feature/fix",
            workProject: "지반 모니터링",
            accentClass: "category-government",
            title: "atlas · feature/fix · 지반 모니터링",
          }),
        ],
      ]),
    });

    const context = container.querySelector(".pane-context") as HTMLElement;
    expect(context.textContent).toBe("atlasfeature/fix지반 모니터링");
    expect(context.title).toBe("atlas · feature/fix · 지반 모니터링");
    // The colour rides on the header itself, so the stripe covers both of its rows.
    expect(container.querySelector(".pane-header")!.classList.contains("category-government")).toBe(true);
  });

  it("names the folder alone when the pane is not on a worktree or in a work project", () => {
    const { container } = renderGrid();

    expect((container.querySelector(".pane-context") as HTMLElement).textContent).toBe("atlas");
    expect(container.querySelector(".pane-context-branch")).toBeNull();
    expect(container.querySelector(".pane-context-project")).toBeNull();
    expect(container.querySelector(".pane-header")!.className).toBe("pane-header");
  });

  it("leaves the line out entirely for a pane whose folder can no longer be resolved", () => {
    const { container } = renderGrid({ paneContexts: new Map() });
    expect(container.querySelector(".pane-context")).toBeNull();
  });

  it("gives a document the same folder line, in place of the label it used to repeat", () => {
    const { container } = renderGrid({
      layout: layoutById("cols:1-1")!,
      slots: [
        sessionSlot(makeSession("session-1")),
        {
          kind: "document",
          document: {
            id: "file:project:atlas:README.md",
            kind: "file",
            label: "README.md",
            detail: "atlas",
            dirty: false,
            owner: { kind: "project", id: "project-atlas" },
          },
          content: <div />,
        },
      ],
      paneContexts: new Map([
        ["file:project:atlas:README.md", paneContext({ workProject: "지반 모니터링", accentClass: "category-government" })],
      ]),
    });

    const header = screen.getByLabelText("README.md").querySelector(".pane-header") as HTMLElement;
    expect(header.querySelector(".pane-context")!.textContent).toBe("atlas지반 모니터링");
    expect(header.classList.contains("category-government")).toBe(true);
    expect(container.querySelector(".pane-detail")).toBeNull();
  });
});
