import type { TerminalSessionView } from "@shared/api-types";
import type { SessionIndicators } from "@shared/terminal-types";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PaneHeader session ID", () => {
  function clipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "multiCliWork", {
      configurable: true,
      value: { clipboard: { writeText } },
    });
    return writeText;
  }

  it("shows an abbreviated app ID and full tooltip without folder information", () => {
    renderHeader(makeSession({ id: "abcdefgh-123456", providerConversationId: "provider-id" }));
    expect(screen.getByText("abcdefgh…").parentElement).toHaveAttribute("title", "세션 ID: abcdefgh-123456");
    expect(screen.getByRole("button", { name: "세션 ID 복사" })).toHaveAttribute("title", "세션 ID: abcdefgh-123456");
    expect(screen.queryByText("provider-id")).toBeNull();
  });

  it("copies exact IDs for separate panes, including short IDs and exited sessions", async () => {
    const writeText = clipboard();
    renderHeader(makeSession({ id: "12345678", status: "exited" }));
    renderHeader(makeSession({ id: "other-session-id" }));
    expect(screen.getByText("12345678")).toBeVisible();
    const buttons = screen.getAllByRole("button", { name: "세션 ID 복사" });
    buttons[0].focus();
    expect(buttons[0]).toHaveFocus();
    await act(async () => buttons[0].click());
    await act(async () => fireEvent.click(buttons[1]));
    expect(writeText.mock.calls).toEqual([["12345678"], ["other-session-id"]]);
  });

  it("shows success for two seconds and allows retry after a failure", async () => {
    vi.useFakeTimers();
    const writeText = clipboard().mockRejectedValueOnce(new Error("unavailable"));
    renderHeader(makeSession());
    const button = screen.getByRole("button", { name: "세션 ID 복사" });
    await act(async () => fireEvent.click(button));
    expect(screen.getByRole("status")).toHaveTextContent("복사하지 못했습니다. 다시 시도하세요.");
    expect(button).toBeEnabled();
    await act(async () => fireEvent.click(button));
    expect(screen.getByRole("status")).toHaveTextContent("복사됨");
    expect(button.querySelector(".lucide-check")).not.toBeNull();
    act(() => vi.advanceTimersByTime(1999));
    expect(screen.getByRole("status")).toHaveTextContent("복사됨");
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("prevents ID dragging from reaching the header drag handle", () => {
    const { container } = renderHeader(makeSession());
    const id = container.querySelector(".pane-session-id")!;
    expect(fireEvent.dragStart(id)).toBe(false);
  });
});

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

  it("shows a working badge without inventing progress, and removes it when idle", () => {
    const { container } = renderHeader(makeSession({ status: "working" }));
    expect(screen.getByText("작업 중")).toHaveClass("pane-working-badge");
    expect(container.querySelector(".pane-progress")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    cleanup();
    const idle = renderHeader(makeSession({ status: "idle" }));
    expect(idle.container.querySelector(".pane-progress")).toBeNull();
    expect(screen.queryByText("작업 중")).toBeNull();
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
