import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { SessionTabs } from "./SessionTabs";

afterEach(cleanup);

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

function tabNames() {
  return screen
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? button.textContent);
}

describe("SessionTabs", () => {
  it("keeps the host's order and marks the open session", () => {
    render(
      <SessionTabs
        sessions={[s("b", { updatedAt: "1" }), s("a", { updatedAt: "9" }), s("c", { status: "exited" })]}
        activeSessionId="a"
        onSelect={vi.fn()}
        onNewSession={vi.fn()}
      />,
    );
    expect(tabNames()).toEqual(["b, 작업 중", "a, 작업 중", "c, 종료됨", "새 세션"]);
    expect(screen.getByRole("button", { name: "a, 작업 중" })).toHaveAttribute("aria-current", "true");
  });

  it("adds the folder to labels that would otherwise look the same", () => {
    render(
      <SessionTabs
        sessions={[s("1", { label: "claude", projectName: "A" }), s("2", { label: "claude", projectName: "B" })]}
        activeSessionId="1"
        onSelect={vi.fn()}
        onNewSession={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "claude · A, 작업 중" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "claude · B, 작업 중" })).toBeInTheDocument();
  });

  it("counts the other waiting sessions and jumps to the next one", () => {
    const onSelect = vi.fn();
    render(
      <SessionTabs
        sessions={[
          s("1", { status: "awaiting-input" }),
          s("2", { status: "awaiting-approval" }),
          s("3"),
          s("4", { status: "awaiting-input" }),
        ]}
        activeSessionId="2"
        onSelect={onSelect}
        onNewSession={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "대기 2" }));
    expect(onSelect).toHaveBeenCalledWith("4");
    fireEvent.click(screen.getByRole("button", { name: "1, 입력 대기" }));
    expect(onSelect).toHaveBeenLastCalledWith("1");
  });

  it("hides the waiting count when nothing else waits", () => {
    render(
      <SessionTabs
        sessions={[s("1", { status: "awaiting-input" }), s("2")]}
        activeSessionId="1"
        onSelect={vi.fn()}
        onNewSession={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /^대기/ })).not.toBeInTheDocument();
  });

  it("opens the new session form from +", () => {
    const onNewSession = vi.fn();
    render(<SessionTabs sessions={[s("1")]} activeSessionId="1" onSelect={vi.fn()} onNewSession={onNewSession} />);
    fireEvent.click(screen.getByRole("button", { name: "새 세션" }));
    expect(onNewSession).toHaveBeenCalled();
  });

  it("leaves hidden sessions out, unless that is the one open", () => {
    render(
      <SessionTabs
        sessions={[s("a"), s("h", { hidden: true }), s("o", { hidden: true })]}
        activeSessionId="o"
        onSelect={vi.fn()}
        onNewSession={vi.fn()}
      />,
    );
    expect(tabNames()).toEqual(["a, 작업 중", "o, 작업 중", "새 세션"]);
  });
});
