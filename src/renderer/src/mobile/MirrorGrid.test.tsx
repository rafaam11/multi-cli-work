import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteMirrorView, RemoteSessionSummary } from "@shared/remote-types";
import { MIRROR_PANE_DRAG_TYPE, MirrorGrid } from "./MirrorGrid";

const SESSIONS: RemoteSessionSummary[] = [
  { id: "s1", projectId: "p", projectName: "A", kind: "claude", label: "리팩터", status: "working", updatedAt: "1" },
  { id: "s2", projectId: "p", projectName: "A", kind: "shell", label: "빌드", status: "idle", updatedAt: "2" },
];

const VIEW: RemoteMirrorView = {
  place: { kind: "folder", projectId: "p", worktreeId: null },
  layoutId: "cols:2-1",
  columnRows: [2, 1],
  page: 0,
  pages: 1,
  focusedPaneId: "s1",
  zoomedPaneId: null,
  slots: [{ kind: "session", id: "s1" }, { kind: "document", id: "doc", label: "README.md" }, { kind: "session", id: "s2" }],
};

/** 두 칸 중 둘째가 빈 칸. */
const WITH_EMPTY: RemoteMirrorView = {
  ...VIEW,
  layoutId: "cols:2",
  columnRows: [1, 1],
  slots: [{ kind: "session", id: "s1" }, null],
};

function renderGrid(view: RemoteMirrorView = VIEW, onNewSession?: () => void) {
  const onView = vi.fn();
  render(
    <MirrorGrid
      view={view}
      placeLabel="A"
      sessions={SESSIONS}
      disabled={false}
      onView={onView}
      onNewSession={onNewSession}
      renderPane={(pane) => (
        <div data-testid="pane" data-zoomed={pane.zoomed} draggable onDragStart={pane.onDragStart}>
          {pane.session.label}
          {pane.actions}
          <button type="button" onClick={pane.onToggleZoom}>
            {pane.session.label} 확대
          </button>
        </div>
      )}
    />,
  );
  return onView;
}

function dataTransfer() {
  const data = new Map<string, string>();
  return {
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    effectAllowed: "",
  };
}

afterEach(cleanup);

describe("MirrorGrid", () => {
  it("draws sessions and host documents in the host's layout", () => {
    const onView = renderGrid();
    expect(screen.getAllByTestId("pane").map((pane) => pane.textContent)).toEqual([
      expect.stringContaining("리팩터"),
      expect.stringContaining("빌드"),
    ]);
    expect(screen.getByRole("heading", { name: "README.md" })).toBeInTheDocument();
    // The host's own picker: a split layout marks the tile for its column count.
    expect(screen.getByRole("radio", { name: "2열" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("group", { name: "페이지" })).not.toBeInTheDocument();

    // The first column holds two panes, so each merges; the single third pane splits.
    fireEvent.click(screen.getAllByRole("button", { name: "열 합치기" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "열 나누기" }));
    fireEvent.click(screen.getByRole("button", { name: "호스트에서 열린 문서: README.md 칸 닫기" }));
    fireEvent.click(screen.getByRole("radio", { name: "3열" }));
    expect(onView.mock.calls.map(([action]) => action)).toEqual([
      { action: "merge", slot: 1 },
      { action: "split", slot: 2 },
      { action: "close", slot: 1, paneId: "doc" },
      { action: "layout", layoutId: "cols:1-1-1" },
    ]);
  });

  it("offers a new session in an empty slot, with no column buttons", () => {
    const onNewSession = vi.fn();
    renderGrid(WITH_EMPTY, onNewSession);
    const empty = screen.getByLabelText("빈 칸");
    expect(empty).toHaveTextContent("2");
    fireEvent.click(screen.getByRole("button", { name: "새 세션" }));
    expect(onNewSession).toHaveBeenCalledOnce();
    // Only the session pane carries the column button.
    expect(screen.getAllByRole("button", { name: "열 나누기" })).toHaveLength(1);
  });

  it("moves a pane dragged by its header onto another slot", () => {
    const onView = renderGrid(WITH_EMPTY);
    const transfer = dataTransfer();
    fireEvent.dragStart(screen.getByTestId("pane"), { dataTransfer: transfer });
    expect(transfer.getData(MIRROR_PANE_DRAG_TYPE)).toBe("s1");
    fireEvent.drop(screen.getByLabelText("빈 칸"), { dataTransfer: transfer });
    expect(onView).toHaveBeenCalledWith({ action: "move", paneId: "s1", slot: 1 });
  });

  it("shows the host's zoomed pane alone and keeps the rest mounted", () => {
    const onView = renderGrid({ ...VIEW, zoomedPaneId: "s2" });
    const panes = screen.getAllByTestId("pane");
    expect(panes).toHaveLength(2);
    expect(panes[0]!.closest(".m-mirror-slot")).toHaveClass("m-parked");
    expect(panes[1]!.closest(".m-mirror-slot")).not.toHaveClass("m-parked");
    expect(panes[1]).toHaveAttribute("data-zoomed", "true");
    // No column changes while zoomed — the host hides them too.
    expect(screen.queryByRole("button", { name: "열 합치기" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "빌드 확대" }));
    fireEvent.click(screen.getByRole("button", { name: "리팩터 확대" }));
    expect(onView.mock.calls.map(([action]) => action)).toEqual([
      { action: "zoom", paneId: null },
      { action: "zoom", paneId: "s1" },
    ]);
  });

  it("says when the host is not showing a grid", () => {
    renderGrid({ ...VIEW, place: { kind: "other" }, columnRows: [], slots: [] });
    expect(screen.getByText(/그리드가 아닌 화면/)).toBeInTheDocument();
    expect(screen.queryByTestId("pane")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "레이아웃 선택" })).not.toBeInTheDocument();
  });
});
