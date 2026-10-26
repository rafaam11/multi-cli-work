import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteMirrorView, RemoteSessionSummary } from "@shared/remote-types";
import { MIRROR_PANE_DRAG_TYPE, MirrorGrid } from "./MirrorGrid";

const SESSIONS: RemoteSessionSummary[] = [
  { id: "s1", projectId: "p", projectName: "A", kind: "claude", label: "리팩터", status: "working", updatedAt: "1" },
];

const VIEW: RemoteMirrorView = {
  place: { kind: "folder", projectId: "p", worktreeId: null },
  layoutId: "cols:2-1",
  columnRows: [2, 1],
  page: 0,
  pages: 1,
  focusedPaneId: "s1",
  slots: [{ kind: "session", id: "s1" }, { kind: "document", id: "doc", label: "README.md" }, null],
};

function renderGrid(view: RemoteMirrorView = VIEW) {
  const onView = vi.fn();
  render(
    <MirrorGrid
      view={view}
      placeLabel="A"
      sessions={SESSIONS}
      disabled={false}
      onView={onView}
      renderPane={(pane) => (
        <div data-testid="pane" draggable onDragStart={pane.onDragStart}>
          {pane.session.label}
          {pane.actions}
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
  it("draws sessions, host documents and empty slots in the host's layout", () => {
    const onView = renderGrid();
    expect(screen.getByTestId("pane")).toHaveTextContent("리팩터");
    expect(screen.getByText("호스트에서 열린 문서: README.md")).toBeInTheDocument();
    expect(screen.getByText("빈 칸")).toBeInTheDocument();
    // A split layout the picker does not list still shows as what it is.
    expect(screen.getByRole("combobox")).toHaveValue("cols:2-1");
    expect(screen.queryByRole("group", { name: "페이지" })).not.toBeInTheDocument();

    // The first column holds two panes, so each merges; the single third pane splits.
    fireEvent.click(screen.getAllByRole("button", { name: "열 합치기" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "열 나누기" }));
    fireEvent.click(screen.getByRole("button", { name: "호스트에서 열린 문서: README.md 칸 닫기" }));
    expect(onView.mock.calls.map(([action]) => action)).toEqual([
      { action: "merge", slot: 1 },
      { action: "split", slot: 2 },
      { action: "close", slot: 1 },
    ]);
  });

  it("moves a pane dragged by its header onto another slot", () => {
    const onView = renderGrid();
    const transfer = dataTransfer();
    fireEvent.dragStart(screen.getByTestId("pane"), { dataTransfer: transfer });
    expect(transfer.getData(MIRROR_PANE_DRAG_TYPE)).toBe("s1");
    fireEvent.drop(screen.getByText("빈 칸").closest(".m-mirror-slot")!, { dataTransfer: transfer });
    expect(onView).toHaveBeenCalledWith({ action: "move", paneId: "s1", slot: 2 });
  });

  it("says when the host is not showing a grid", () => {
    renderGrid({ ...VIEW, place: { kind: "other" }, columnRows: [], slots: [] });
    expect(screen.getByText(/그리드가 아닌 화면/)).toBeInTheDocument();
    expect(screen.queryByTestId("pane")).not.toBeInTheDocument();
  });
});
