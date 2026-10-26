import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { SessionList } from "./SessionList";

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const s = (id: string, overrides: Partial<RemoteSessionSummary> = {}): RemoteSessionSummary => ({
  id,
  projectId: "p",
  projectName: "A",
  kind: "claude",
  label: id,
  status: "working",
  updatedAt: "",
  ...overrides,
});

function renderList(sessions: RemoteSessionSummary[], props: Partial<Parameters<typeof SessionList>[0]> = {}) {
  return render(
    <SessionList
      hostName="PC"
      connection="open"
      sessions={sessions}
      onOpen={vi.fn()}
      onUnpair={vi.fn()}
      onNewSession={vi.fn()}
      {...props}
    />,
  );
}

function rowNames() {
  return within(screen.getByRole("list", { name: "세션 목록" }))
    .getAllByRole("button")
    .filter((button) => button.classList.contains("m-row-open"))
    .map((button) => button.getAttribute("aria-label"));
}

describe("SessionList", () => {
  it("shows status and opens a session", () => {
    const onOpen = vi.fn();
    renderList([s("1", { label: "리팩터", status: "awaiting-input" })], { onOpen, leaveLabel: "호스트 목록" });
    expect(screen.getByRole("button", { name: "호스트 목록" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "리팩터, 입력 대기" }));
    expect(onOpen).toHaveBeenCalledWith("1");
  });

  it("lists sessions in one line, most urgent first, like the main window's panel", () => {
    renderList([
      s("idle", { status: "idle" }),
      s("work", { projectName: "B" }),
      s("ask", { status: "awaiting-approval", projectName: "B" }),
    ]);
    expect(rowNames()).toEqual(["ask, 승인 대기", "work, 작업 중", "idle, 대기"]);
  });

  it("shows the folder and branch, but not again under a row from the same place", () => {
    renderList([
      s("1", { worktreeBranch: "feat/search", updatedAt: "2" }),
      s("2", { worktreeBranch: "feat/search", updatedAt: "1" }),
    ]);
    const [first, second] = within(screen.getByRole("list", { name: "세션 목록" })).getAllByRole("listitem");
    expect(first).toHaveTextContent("feat/search");
    expect(first).toHaveTextContent("A");
    expect(second).not.toHaveTextContent("feat/search");
  });

  it("jumps to a waiting session and can show only those", () => {
    const onOpen = vi.fn();
    renderList([s("1"), s("2", { status: "awaiting-approval" })], { onOpen });
    fireEvent.click(screen.getByRole("button", { name: "대기 1" }));
    expect(onOpen).toHaveBeenCalledWith("2");
    fireEvent.click(screen.getByRole("button", { name: "대기" }));
    expect(rowNames()).toEqual(["2, 승인 대기"]);
    expect(window.localStorage.getItem("mcw.remote.waitingOnly.v1")).toBe("1");
  });

  it("folds sessions hidden on the host into a closed 숨김 shelf at the bottom", () => {
    renderList([s("a"), s("h", { hidden: true })]);
    expect(rowNames()).toEqual(["a, 작업 중"]);
    const toggle = screen.getByRole("button", { name: /숨김\s*1/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "숨김 세션" })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(within(screen.getByRole("list", { name: "숨김 세션" })).getByRole("button", { name: "h, 작업 중" })).toBeInTheDocument();
  });

  it("hides and shows sessions again on the host", () => {
    const onMoveShelf = vi.fn();
    renderList([s("a"), s("h", { hidden: true })], { onMoveShelf });
    fireEvent.click(screen.getByRole("button", { name: "a 작업공간에서 숨기기" }));
    expect(onMoveShelf).toHaveBeenCalledWith("a", "hidden");
    fireEvent.click(screen.getByRole("button", { name: /숨김\s*1/ }));
    fireEvent.click(screen.getByRole("button", { name: "h 작업공간에 다시 표시" }));
    expect(onMoveShelf).toHaveBeenCalledWith("h", "active");
  });

  it("marks the sessions on screen and the one with focus", () => {
    renderList([s("1"), s("2"), s("3")], { activeSessionId: "1", onScreenSessionIds: ["1", "2"] });
    const row = (name: string) => screen.getByRole("button", { name }).closest(".m-row");
    expect(row("1, 작업 중")).toHaveClass("current");
    expect(row("2, 작업 중")).toHaveClass("on-screen");
    expect(row("3, 작업 중")).not.toHaveClass("on-screen");
  });

  it("says when there is nothing to show and when the link is down", () => {
    renderList([], { connection: "reconnecting" });
    expect(screen.getByText("열린 세션이 없습니다")).toBeInTheDocument();
    expect(screen.getByText("다시 연결하는 중…")).toBeInTheDocument();
  });
});
