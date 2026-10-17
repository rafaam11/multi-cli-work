import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AgentView } from "@shared/agent-types";
import type { TerminalSessionView } from "@shared/api-types";
import type { BoardMessage } from "@shared/board-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamBoard } from "./TeamBoard";

afterEach(cleanup);

function session(overrides: Partial<TerminalSessionView>): TerminalSessionView {
  return {
    id: "builder",
    projectId: "p1",
    tool: null,
    title: null,
    name: "빌더",
    kind: "claude",
    cwd: "C:\\Work",
    providerConversationId: null,
    interruptedByShutdown: false,
    status: "working",
    pid: 1,
    exitCode: null,
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
    ...overrides,
  };
}

const sessions = [session({}), session({ id: "reviewer", name: "리뷰어", kind: "codex", status: "idle" })];
const agents = [
  { id: "claude", label: "Claude Code", icon: "claude" },
  { id: "codex", label: "Codex", icon: "codex" },
] as AgentView[];

const direct: BoardMessage = {
  id: "m1",
  projectId: "p1",
  author: { kind: "session", sessionId: "builder", name: "빌더", agent: "claude" },
  kind: "direct",
  text: "diff 검토해 줘",
  to: [{ sessionId: "reviewer", name: "리뷰어", agent: "codex", delivery: "held", reason: "working" }],
  createdAt: new Date().toISOString(),
};

let changeListener: ((message: BoardMessage) => void) | null = null;
const board = {
  list: vi.fn(async (): Promise<BoardMessage[]> => [direct]),
  post: vi.fn(async () => direct),
  onChange: vi.fn((listener: (message: BoardMessage) => void) => {
    changeListener = listener;
    return () => undefined;
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(window, { multiCliWork: { board } });
});

function renderBoard(overrides: Partial<Parameters<typeof TeamBoard>[0]> = {}) {
  const props = {
    hidden: false,
    projectId: "p1",
    projectLabel: "atlas",
    sessions,
    agents,
    onFocusSession: vi.fn(),
    onUnreadChange: vi.fn(),
    ...overrides,
  };
  const view = render(<TeamBoard {...props} />);
  return { props, ...view };
}

describe("TeamBoard", () => {
  it("draws a held send as a wire and updates it when it is delivered", async () => {
    const { container } = renderBoard();
    expect(await screen.findByText("diff 검토해 줘")).toBeInTheDocument();
    expect(container.querySelector(".board-wire.delivery-held")).not.toBeNull();
    expect(screen.getByText("작업이 끝나면 전달")).toBeInTheDocument();

    act(() => changeListener?.({ ...direct, to: [{ ...direct.to[0], delivery: "delivered", reason: null }] }));
    await waitFor(() => expect(container.querySelector(".board-wire.delivery-delivered")).not.toBeNull());
    expect(screen.getByText("전달됨")).toBeInTheDocument();
  });

  it("lists the folder's sessions and focuses one from the roster", async () => {
    const { props } = renderBoard();
    await screen.findByText("diff 검토해 줘");
    const roster = screen.getByRole("banner", { name: "atlas의 세션" });
    fireEvent.click(within(roster).getByRole("button", { name: /리뷰어/ }));
    expect(props.onFocusSession).toHaveBeenCalledWith(expect.objectContaining({ id: "reviewer" }));
  });

  it("mentions a session with @ and posts with Enter", async () => {
    renderBoard();
    await screen.findByText("diff 검토해 줘");
    const input = screen.getByRole("textbox", { name: "팀 보드에 쓰기" });
    fireEvent.change(input, { target: { value: "@리", selectionStart: 2 } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("@리뷰어 ");
    fireEvent.change(input, { target: { value: "@리뷰어 확인 부탁", selectionStart: 10 } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(board.post).toHaveBeenCalledWith({ projectId: "p1", text: "@리뷰어 확인 부탁", mentions: ["reviewer"] }),
    );
  });

  it("counts what arrives while hidden as unread", async () => {
    const { props } = renderBoard({ hidden: true });
    await waitFor(() => expect(board.list).toHaveBeenCalled());
    act(() => changeListener?.({ ...direct, id: "m2" }));
    await waitFor(() => expect(props.onUnreadChange).toHaveBeenLastCalledWith(1));
  });

  it("asks for a folder when none is selected", () => {
    renderBoard({ projectId: null });
    expect(screen.getByText("폴더를 고르면 그 폴더의 팀 보드가 열립니다.")).toBeInTheDocument();
  });
});
