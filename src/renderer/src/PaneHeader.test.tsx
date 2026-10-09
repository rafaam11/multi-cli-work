import type { TerminalSessionView } from "@shared/api-types";
import type { SessionIndicators } from "@shared/terminal-types";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaneHeader } from "./PaneHeader";

function makeSession(overrides: Partial<TerminalSessionView> = {}): TerminalSessionView {
  return {
    id: "session-1",
    projectId: "project-atlas",
    tool: null,
    title: null,
    name: "session-1",
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

function renderHeader(session: TerminalSessionView, indicators?: SessionIndicators) {
  return render(
    <PaneHeader
      session={session}
      label="빌드"
      context={null}
      agents={[]}
      renaming={false}
      pendingAction={false}
      resumeBlocked={false}
      columnSplit={{ split: false, canSplit: true, onSplit: vi.fn(), onMerge: vi.fn() }}
      indicators={indicators}
      clearAction={null}
      onStartRename={vi.fn()}
      onRename={vi.fn()}
      onCancelRename={vi.fn()}
      onResume={vi.fn()}
      onStop={vi.fn()}
      onClearSlot={vi.fn()}
      onRemove={vi.fn()}
      onContextMenu={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe("PaneHeader indicators", () => {
  it("draws a reported progress as a bar filled to its value", () => {
    const { container } = renderHeader(makeSession({ status: "working" }), {
      progress: { state: "normal", value: 40 },
      chips: [],
    });
    const bar = screen.getByRole("progressbar", { name: "진행률" });
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(bar.className).toContain("pane-progress-normal");
    expect((container.querySelector(".pane-progress-fill") as HTMLElement).style.width).toBe("40%");
  });

  it("marks an error or a stall by state, and runs an indeterminate report without a value", () => {
    renderHeader(makeSession(), { progress: { state: "error", value: 70 }, chips: [] });
    expect(screen.getByRole("progressbar").className).toContain("pane-progress-error");
    cleanup();
    renderHeader(makeSession(), { progress: { state: "indeterminate", value: null }, chips: [] });
    const bar = screen.getByRole("progressbar");
    expect(bar.className).toContain("pane-progress-indeterminate");
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
  });

  it("shimmers while the session works and nothing reports progress, and shows nothing when it is idle", () => {
    const { container } = renderHeader(makeSession({ status: "working" }));
    expect(container.querySelector(".pane-progress-working")).not.toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    cleanup();
    const idle = renderHeader(makeSession({ status: "idle" }));
    expect(idle.container.querySelector(".pane-progress")).toBeNull();
  });

  it("shows the pinned chips in order with their colour", () => {
    renderHeader(makeSession(), {
      progress: null,
      chips: [
        { key: "tests", text: "12/40", color: "blue" },
        { key: "build", text: "빌드 중", color: "amber" },
      ],
    });
    const chips = screen.getAllByTestId("pane-chip");
    expect(chips.map((chip) => chip.textContent)).toEqual(["12/40", "빌드 중"]);
    expect(chips[1].className).toContain("pane-chip-amber");
    expect(chips[0].getAttribute("title")).toBe("tests: 12/40");
  });
});
