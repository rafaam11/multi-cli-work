import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteMirror, RemoteSessionSummary } from "@shared/remote-types";
import { MobileApp } from "./MobileApp";

// 터미널(xterm)은 jsdom에서 그려지지 않는다 — 어떤 세션이 어떤 모드로 열렸는지만 본다.
vi.mock("./SessionScreen", () => ({
  SessionScreen: ({
    session,
    wide,
    onMeasured,
    onBack,
    tabs,
    focused = true,
    onClose,
    onFocus,
    paneActions,
    onRename,
    onReady,
  }: {
    session: RemoteSessionSummary;
    wide?: boolean;
    onMeasured?(size: { cols: number; rows: number }): void;
    onBack(): void;
    tabs?: ReactNode;
    focused?: boolean;
    onClose?(): void;
    onFocus?(): void;
    paneActions?: ReactNode;
    onRename?(name: string): void;
    onReady?(ready: boolean): void;
  }) => (
    <div data-testid="screen" data-wide={String(Boolean(wide))} data-focused={String(focused)}>
      <span data-testid="screen-label">{session.label}</span>
      <button type="button" onClick={() => onReady?.(true)}>{session.label} 렌더 완료</button>
      {onFocus ? (
        <button type="button" onClick={onFocus}>
          {session.label} 칸 고르기
        </button>
      ) : null}
      {paneActions}
      {onClose ? (
        <button type="button" onClick={onClose}>
          {session.label} 칸 닫기
        </button>
      ) : null}
      {onRename ? (
        <button type="button" onClick={() => onRename("새 이름")}>
          {session.label} 이름 바꾸기
        </button>
      ) : null}
      <button type="button" onClick={onBack}>
        세션 목록으로
      </button>
      {tabs}
      {onMeasured ? (
        <button type="button" onClick={() => onMeasured({ cols: 150, rows: 40 })}>
          재기
        </button>
      ) : null}
    </div>
  ),
}));

class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  sent: Array<{ type: string; [key: string]: unknown }> = [];
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as { type: string });
  }
  close(): void {}
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const SESSIONS: RemoteSessionSummary[] = [
  { id: "s1", projectId: "p", projectName: "A", kind: "claude", label: "리팩터", status: "working", updatedAt: "2" },
  { id: "s2", projectId: "p", projectName: "A", kind: "codex", label: "테스트", status: "idle", updatedAt: "1" },
];

function useScreen(wide: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: wide,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function connect() {
  act(() => {
    FakeSocket.last!.onopen?.();
    FakeSocket.last!.receive({ type: "welcome", hostId: "h", hostName: "회사PC", deviceId: "d", protocolVersion: 1, shellLatest: null });
    FakeSocket.last!.receive({ type: "sessions", sessions: SESSIONS });
  });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("WebSocket", FakeSocket);
  (window as unknown as { McwShell: unknown }).McwShell = {
    bridgeVersion: () => 1,
    pairingJson: () => JSON.stringify({ token: "t", deviceId: "d", hostName: "회사PC" }),
    unpaired: vi.fn(),
    backToHosts: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (window as unknown as { McwShell?: unknown }).McwShell;
  window.history.replaceState(null, "", window.location.pathname);
});

function focusedLabel() {
  return screen
    .getAllByTestId("screen")
    .find((element) => element.dataset.focused === "true")
    ?.querySelector("[data-testid=screen-label]")?.textContent;
}

function screenLabels() {
  return screen.queryAllByTestId("screen-label").map((element) => element.textContent);
}

describe("MobileApp", () => {
  it("acknowledges only the rendered focused grid session and clears it when the host shows a document", () => {
    useScreen(true);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    render(<MobileApp />);
    connect();
    const mirror: RemoteMirror = {
      tree: [],
      view: { place: { kind: "shelf", shelf: "active" }, layoutId: "cols:1-1", columnRows: [1, 1],
        page: 0, pages: 1, focusedPaneId: "s1", slots: [{ kind: "session", id: "s1" }, { kind: "session", id: "s2" }] },
    };
    act(() => {
      FakeSocket.last!.receive({ type: "welcome", hostId: "h", hostName: "PC", deviceId: "d", protocolVersion: 1, capabilities: ["session-seen-v1"] });
      FakeSocket.last!.receive({ type: "sessions", sessions: SESSIONS.map(session => ({ ...session, attention: { generation: 1, seenThrough: 0 } })) });
      FakeSocket.last!.receive({ type: "mirror", mirror });
    });
    fireEvent.click(screen.getByRole("button", { name: "테스트 렌더 완료" }));
    expect(FakeSocket.last!.sent.filter(message => message.type === "seen")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "리팩터 렌더 완료" }));
    expect(FakeSocket.last!.sent.filter(message => message.type === "seen")).toEqual([{ type: "seen", sessionId: "s1", generation: 1 }]);
    act(() => FakeSocket.last!.receive({ type: "mirror", mirror: { ...mirror, view: { ...mirror.view, focusedPaneId: "s2" } } }));
    expect(FakeSocket.last!.sent.filter(message => message.type === "seen")).toHaveLength(2);
    act(() => {
      FakeSocket.last!.receive({ type: "mirror", mirror: { ...mirror, view: { ...mirror.view, focusedPaneId: "doc", slots: [{ kind: "document", id: "doc", label: "README" }] } } });
      FakeSocket.last!.receive({ type: "sessions", sessions: SESSIONS.map(session => ({ ...session, attention: { generation: 2, seenThrough: 0 } })) });
    });
    expect(FakeSocket.last!.sent.filter(message => message.type === "seen")).toHaveLength(2);
  });

  it("selects a drawer session and preserves one session history entry", async () => {
    useScreen(false);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "리팩터, 작업 중" }));
    fireEvent.click(screen.getByRole("button", { name: "세션 사이드바 열기" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /테스트/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("screen-label")).toHaveTextContent("테스트");
    expect(window.location.hash).toBe("#session=s2");
    fireEvent.click(screen.getByRole("button", { name: "세션 목록으로" }));
    await waitFor(() => expect(screen.queryByTestId("screen")).not.toBeInTheDocument());
  });

  it("opens a path drawer without replacing the terminal and Back closes only the drawer", async () => {
    useScreen(false);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "리팩터, 작업 중" }));
    const terminal = screen.getByTestId("screen");
    fireEvent.click(screen.getByRole("button", { name: "세션 사이드바 열기" }));
    expect(screen.getByRole("dialog", { name: "프로젝트와 경로별 세션" })).toBeInTheDocument();
    expect(screen.getByText("경로 정보 없음", { selector: ".m-drawer-path-label" })).toBeInTheDocument();
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByTestId("screen")).toBe(terminal);
    expect(window.location.hash).toBe("#session=s1");
  });

  it("keeps the list beside the open session on a wide screen", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    expect(screen.getByText("왼쪽에서 세션을 고르세요")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "리팩터, 작업 중" }));
    expect(screen.getByTestId("screen")).toHaveTextContent("리팩터");
    expect(screen.getByTestId("screen")).toHaveAttribute("data-wide", "true");
    expect(screen.getByRole("button", { name: "테스트, 대기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "리팩터, 작업 중" })).toHaveAttribute("aria-current", "true");
  });

  it("replaces the list with the session on a narrow screen", () => {
    useScreen(false);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "리팩터, 작업 중" }));
    expect(screen.getByTestId("screen")).toHaveAttribute("data-wide", "false");
    expect(screen.queryByRole("heading", { name: "회사PC" })).not.toBeInTheDocument();
  });

  it("switches sessions from the tab strip without stacking history, and goes back to the list", async () => {
    useScreen(false);
    render(<MobileApp />);
    connect();
    const before = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "리팩터, 작업 중" }));
    expect(window.location.hash).toBe("#session=s1");
    expect(window.history.length).toBe(before + 1);
    fireEvent.click(screen.getByRole("button", { name: "테스트, 대기" }));
    expect(screen.getByTestId("screen-label")).toHaveTextContent("테스트");
    expect(window.location.hash).toBe("#session=s2");
    expect(window.history.length).toBe(before + 1);
    fireEvent.click(screen.getByRole("button", { name: "세션 목록으로" }));
    await waitFor(() => expect(screen.queryByTestId("screen")).not.toBeInTheDocument());
    expect(window.location.hash).toBe("");
  });

  it("returns to the list on the browser's back", async () => {
    useScreen(false);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "리팩터, 작업 중" }));
    act(() => window.history.back());
    await waitFor(() => expect(screen.getByRole("heading", { name: "회사PC" })).toBeInTheDocument());
  });

  it("puts the list under a session opened by link, so one back reaches the list", async () => {
    useScreen(false);
    window.location.hash = "#session=s2";
    render(<MobileApp />);
    connect();
    expect(screen.getByTestId("screen-label")).toHaveTextContent("테스트");
    fireEvent.click(screen.getByRole("button", { name: "세션 목록으로" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "회사PC" })).toBeInTheDocument());
    expect(window.location.hash).toBe("");
  });

  it("goes from a tab's + to the new session form on the list", async () => {
    useScreen(false);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "리팩터, 작업 중" }));
    fireEvent.click(screen.getByRole("button", { name: "새 세션" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "회사PC" })).toBeInTheDocument());
    expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
    expect(FakeSocket.last!.sent).toContainEqual({ type: "catalog" });
  });

  it("has no tab strip beside the list on a wide screen", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "리팩터, 작업 중" }));
    expect(screen.queryByRole("navigation", { name: "세션 탭" })).not.toBeInTheDocument();
  });

  it("opens the session a link points at, and follows a new link", () => {
    useScreen(true);
    window.location.hash = "#session=s2";
    render(<MobileApp />);
    connect();
    expect(screen.getByTestId("screen")).toHaveTextContent("테스트");
    act(() => {
      window.location.hash = "#session=s1";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(focusedLabel()).toBe("리팩터");
  });

  it("asks for the catalog and starts a session", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "새 세션" }));
    expect(FakeSocket.last!.sent).toContainEqual({ type: "catalog" });
    expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
    act(() => {
      FakeSocket.last!.receive({
        type: "catalog",
        projects: [{ id: "p1", name: "multi-cli-work", worktrees: [] }],
        agents: [{ id: "claude", label: "Claude" }],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    // 아직 연 세션이 없어 잰 크기가 없다 — 창 크기로 어림한다(jsdom 1024×768).
    expect(FakeSocket.last!.sent).toContainEqual({ type: "create", projectId: "p1", kind: "claude", cols: 102, rows: 45 });
    expect(screen.queryByRole("button", { name: "시작" })).not.toBeInTheDocument();
  });

  it("starts a session at the size the open session screen measured", () => {
    useScreen(true);
    window.location.hash = "#session=s2";
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "재기" }));
    fireEvent.click(screen.getByRole("button", { name: "새 세션" }));
    act(() => {
      FakeSocket.last!.receive({
        type: "catalog",
        projects: [{ id: "p1", name: "multi-cli-work", worktrees: [] }],
        agents: [{ id: "claude", label: "Claude" }],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    expect(FakeSocket.last!.sent).toContainEqual({ type: "create", projectId: "p1", kind: "claude", cols: 150, rows: 40 });
  });

  it("starts a session in the worktree chosen on the form", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "새 세션" }));
    act(() => {
      FakeSocket.last!.receive({
        type: "catalog",
        projects: [{ id: "p1", name: "multi-cli-work", worktrees: [{ id: "w1", branch: "feat/x" }] }],
        agents: [{ id: "claude", label: "Claude" }],
      });
    });
    fireEvent.change(screen.getByLabelText("작업 위치"), { target: { value: "w1" } });
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    expect(FakeSocket.last!.sent).toContainEqual(
      expect.objectContaining({ type: "create", projectId: "p1", kind: "claude", worktreeId: "w1" }),
    );
  });

  it("opens the session the host says was started", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    act(() => FakeSocket.last!.receive({ type: "started", sessionId: "s2" }));
    expect(screen.getByTestId("screen")).toHaveTextContent("테스트");
  });

  it("shows what the host refused and lets it be dismissed", () => {
    useScreen(false);
    render(<MobileApp />);
    connect();
    act(() => FakeSocket.last!.receive({ type: "error", code: "failed", message: "이미 실행 중인 세션입니다" }));
    expect(screen.getByRole("alert")).toHaveTextContent("이미 실행 중인 세션입니다");
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("goes back to the list when the open session is removed", () => {
    useScreen(false);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "리팩터, 작업 중" }));
    expect(screen.getByTestId("screen")).toBeInTheDocument();
    act(() => FakeSocket.last!.receive({ type: "removed", sessionId: "s1" }));
    expect(screen.queryByTestId("screen")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "테스트, 대기" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "리팩터, 작업 중" })).not.toBeInTheDocument();
  });

  it("shows the list when the linked session does not exist", () => {
    useScreen(false);
    window.location.hash = "#session=gone";
    render(<MobileApp />);
    connect();
    expect(screen.queryByTestId("screen")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "리팩터, 작업 중" })).toBeInTheDocument();
  });

  it("opens sessions side by side on a wide screen, and moves the focus between them", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "리팩터, 작업 중" }));
    fireEvent.click(screen.getByRole("button", { name: "테스트, 대기" }));
    expect(screenLabels()).toEqual(["리팩터", "테스트"]);
    expect(focusedLabel()).toBe("테스트");
    expect(window.location.hash).toBe("#session=s2");
    fireEvent.click(screen.getByRole("button", { name: "리팩터 칸 고르기" }));
    expect(focusedLabel()).toBe("리팩터");
    expect(window.location.hash).toBe("#session=s1");
    // 이미 떠 있는 세션을 목록에서 고르면 칸을 늘리지 않고 포커스만 옮긴다.
    fireEvent.click(screen.getByRole("button", { name: "테스트, 대기" }));
    expect(screenLabels()).toEqual(["리팩터", "테스트"]);
    expect(focusedLabel()).toBe("테스트");
  });

  it("replaces the focused pane once four are open", () => {
    useScreen(true);
    render(<MobileApp />);
    act(() => {
      FakeSocket.last!.onopen?.();
      FakeSocket.last!.receive({ type: "welcome", hostId: "h", hostName: "회사PC", deviceId: "d", protocolVersion: 1, shellLatest: null });
      FakeSocket.last!.receive({
        type: "sessions",
        sessions: ["a", "b", "c", "d", "e"].map((id) => ({ ...SESSIONS[0]!, id, label: id, updatedAt: id })),
      });
    });
    for (const id of ["a", "b", "c", "d"]) fireEvent.click(screen.getByRole("button", { name: `${id}, 작업 중` }));
    fireEvent.click(screen.getByRole("button", { name: "b 칸 고르기" }));
    fireEvent.click(screen.getByRole("button", { name: "e, 작업 중" }));
    expect(screenLabels()).toEqual(["a", "e", "c", "d"]);
    expect(focusedLabel()).toBe("e");
  });

  it("closes a pane and hands the focus to its neighbour, keeping the panes for next time", () => {
    useScreen(true);
    const { unmount } = render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "리팩터, 작업 중" }));
    fireEvent.click(screen.getByRole("button", { name: "테스트, 대기" }));
    fireEvent.click(screen.getByRole("button", { name: "테스트 칸 닫기" }));
    expect(screenLabels()).toEqual(["리팩터"]);
    expect(focusedLabel()).toBe("리팩터");
    expect(window.location.hash).toBe("#session=s1");
    unmount();
    window.history.replaceState(null, "", window.location.pathname);
    render(<MobileApp />);
    connect();
    expect(screenLabels()).toEqual(["리팩터"]);
  });

  it("asks the host to hide a session and to show it again", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: "리팩터 작업공간에서 숨기기" }));
    expect(FakeSocket.last!.sent).toContainEqual({ type: "shelf", sessionId: "s1", shelf: "hidden" });
  });
});

const MIRROR: RemoteMirror = {
  tree: [
    {
      workProject: null,
      folders: [
        {
          id: "p",
          name: "A",
          missing: false,
          sessionIds: ["s1", "s2"],
          main: { branch: "main", changedFileCount: 2 },
          rootSessionIds: ["s1"],
          worktrees: [{ id: "w1", branch: "feature", changedFileCount: 0, sessionIds: ["s2"] }],
        },
      ],
    },
  ],
  view: {
    place: { kind: "folder", projectId: "p", worktreeId: null },
    layoutId: "auto",
    columnRows: [1, 1],
    page: 0,
    pages: 2,
    focusedPaneId: "s2",
    slots: [
      { kind: "session", id: "s1" },
      { kind: "session", id: "s2" },
    ],
  },
};

function receiveMirror(mirror: RemoteMirror | null) {
  act(() => FakeSocket.last!.receive({ type: "mirror", mirror }));
}

function views() {
  return FakeSocket.last!.sent.filter((message) => message.type === "view");
}

describe("MobileApp following the host screen", () => {
  it("draws the host's grid and asks the host for every change", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    receiveMirror(MIRROR);
    expect(screenLabels()).toEqual(["리팩터", "테스트"]);
    expect(focusedLabel()).toBe("테스트");
    // The hash follows the host's focus.
    expect(window.location.hash).toBe("#session=s2");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "cols:1-1-1" } });
    fireEvent.click(screen.getByRole("button", { name: "리팩터 칸 고르기" }));
    fireEvent.click(screen.getByRole("button", { name: "리팩터 칸 닫기" }));
    fireEvent.click(screen.getByRole("button", { name: "다음 페이지" }));
    fireEvent.click(screen.getAllByRole("button", { name: "열 나누기" })[0]);
    expect(views()).toEqual([
      { type: "view", action: "layout", layoutId: "cols:1-1-1" },
      { type: "view", action: "focus", paneId: "s1" },
      { type: "view", action: "close", slot: 0 },
      { type: "view", action: "page", page: 1 },
      { type: "view", action: "split", slot: 0 },
    ]);
    // Nothing moved here: the grid only changes when the host sends the next mirror.
    expect(screenLabels()).toEqual(["리팩터", "테스트"]);
  });

  it("opens a session from the list or the tree on the host's grid", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    receiveMirror({ ...MIRROR, view: { ...MIRROR.view, slots: [{ kind: "session", id: "s1" }, null] } });
    fireEvent.click(screen.getByRole("button", { name: /^테스트, / }));
    expect(views()).toContainEqual({ type: "view", action: "open", sessionId: "s2" });
    expect(screen.getByText("빈 칸")).toBeInTheDocument();
  });

  it("moves the host to a folder or worktree picked in the tree", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    receiveMirror(MIRROR);
    fireEvent.click(screen.getByRole("button", { name: "A 펼치기" }));
    fireEvent.click(screen.getByRole("button", { name: "A feature" }));
    expect(views()).toContainEqual({ type: "view", action: "select-folder", projectId: "p", worktreeId: "w1" });
  });

  it("opens the new session form on the folder whose + was pressed, and opens the started session on the host", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    receiveMirror(MIRROR);
    fireEvent.click(screen.getByRole("button", { name: "A 펼치기" }));
    fireEvent.click(screen.getByRole("button", { name: "A feature에서 새 세션" }));
    act(() => {
      FakeSocket.last!.receive({
        type: "catalog",
        projects: [
          { id: "other", name: "다른 폴더", worktrees: [] },
          { id: "p", name: "A", worktrees: [{ id: "w1", branch: "feature" }] },
        ],
        agents: [{ id: "claude", label: "Claude" }],
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    expect(FakeSocket.last!.sent).toContainEqual(
      expect.objectContaining({ type: "create", projectId: "p", worktreeId: "w1", kind: "claude" }),
    );
    act(() => FakeSocket.last!.receive({ type: "started", sessionId: "s9" }));
    expect(views()).toContainEqual({ type: "view", action: "open", sessionId: "s9" });
  });

  it("renames a session from its pane", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    receiveMirror(MIRROR);
    fireEvent.click(screen.getByRole("button", { name: "테스트 이름 바꾸기" }));
    expect(FakeSocket.last!.sent).toContainEqual({ type: "rename", sessionId: "s2", name: "새 이름" });
  });

  it("goes back to its own grid when the host window goes away", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    receiveMirror(MIRROR);
    expect(screen.getByRole("region", { name: "호스트 화면" })).toBeInTheDocument();
    receiveMirror(null);
    expect(screen.queryByRole("region", { name: "호스트 화면" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "프로젝트" })).not.toBeInTheDocument();
  });

  it("shows the tree on a narrow screen but leaves the host's screen alone", () => {
    useScreen(false);
    render(<MobileApp />);
    connect();
    receiveMirror(MIRROR);
    expect(screen.queryByRole("region", { name: "호스트 화면" })).not.toBeInTheDocument();
    // A folder row only unfolds; a session row opens the session on this screen.
    fireEvent.click(screen.getByRole("button", { name: "A" }));
    fireEvent.click(screen.getByRole("button", { name: "A feature" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^테스트, / }).at(-1)!);
    expect(views()).toEqual([]);
    expect(screenLabels()).toEqual(["테스트"]);
  });
});
