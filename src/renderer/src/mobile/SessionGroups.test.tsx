import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { SessionGroups } from "./SessionGroups";

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const s = (id: string, overrides: Partial<RemoteSessionSummary> = {}): RemoteSessionSummary => ({
  id,
  projectId: "p",
  projectName: "multi-cli-work",
  kind: "claude",
  label: id,
  status: "working",
  updatedAt: "",
  cwd: "C:\\dev\\multi-cli-work",
  ...overrides,
});

describe("SessionGroups", () => {
  it("shows a path line only when a project has more than one place, shortened", () => {
    render(
      <SessionGroups
        hostId="h"
        activeId={null}
        onSelect={vi.fn()}
        sessions={[
          s("main"),
          s("feature", { cwd: "C:\\dev\\multi-cli-work\\.worktrees\\feature" }),
          s("wiki", { projectId: "q", projectName: "llmwiki", cwd: "C:\\dev\\llmwiki" }),
        ]}
      />,
    );
    const work = within(screen.getByRole("region", { name: "multi-cli-work" }));
    expect(work.getByText("…/.worktrees/feature").closest("button")).toHaveAttribute(
      "title",
      "C:\\dev\\multi-cli-work\\.worktrees\\feature",
    );
    expect(screen.getByRole("region", { name: "llmwiki" }).querySelector(".m-groups-path-label")).toBeNull();
    expect(screen.getByRole("button", { name: "wiki, 작업 중" })).toBeInTheDocument();
  });

  it("marks the open session and opens the one tapped", () => {
    const onSelect = vi.fn();
    render(<SessionGroups hostId="h" activeId="a" onSelect={onSelect} sessions={[s("a"), s("b", { status: "awaiting-input" })]} />);
    expect(screen.getByRole("button", { name: "a, 작업 중" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "b, 입력 대기" })).toHaveClass("m-group-row-await");
    fireEvent.click(screen.getByRole("button", { name: "b, 입력 대기" }));
    expect(onSelect).toHaveBeenCalledWith("b");
  });

  it("folds hidden sessions into a closed 숨김 shelf and remembers opening it", () => {
    render(<SessionGroups hostId="h" activeId={null} onSelect={vi.fn()} sessions={[s("a"), s("h", { hidden: true })]} />);
    expect(screen.queryByRole("button", { name: "h, 작업 중" })).not.toBeInTheDocument();
    const shelf = screen.getByRole("button", { name: /숨김\s*1/ });
    expect(shelf).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(shelf);
    expect(screen.getByRole("button", { name: "h, 작업 중" })).toBeInTheDocument();
    cleanup();
    render(<SessionGroups hostId="h" activeId={null} onSelect={vi.fn()} sessions={[s("a"), s("h", { hidden: true })]} />);
    expect(screen.getByRole("button", { name: "h, 작업 중" })).toBeInTheDocument();
  });
});
