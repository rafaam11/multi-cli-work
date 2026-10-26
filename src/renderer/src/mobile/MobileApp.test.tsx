import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteSessionSummary } from "@shared/remote-types";
import { MobileApp } from "./MobileApp";

// 터미널(xterm)은 jsdom에서 그려지지 않는다 — 어떤 세션이 어떤 모드로 열렸는지만 본다.
vi.mock("./SessionScreen", () => ({
  SessionScreen: ({
    session,
    wide,
    onMeasured,
    onBack,
    tabs,
  }: {
    session: RemoteSessionSummary;
    wide?: boolean;
    onMeasured?(size: { cols: number; rows: number }): void;
    onBack(): void;
    tabs?: ReactNode;
  }) => (
    <div data-testid="screen" data-wide={String(Boolean(wide))}>
      <span data-testid="screen-label">{session.label}</span>
      <button type="button" onClick={onBack}>
        세션 목록으로
      </button>
      {tabs}
      <button type="button" onClick={() => onMeasured?.({ cols: 150, rows: 40 })}>
        재기
      </button>
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
  localStorage.clear();
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
  vi.unstubAllGlobals();
  delete (window as unknown as { McwShell?: unknown }).McwShell;
  window.history.replaceState(null, "", window.location.pathname);
});

describe("MobileApp", () => {
  it("selects a drawer session and preserves one session history entry", async () => {
    useScreen(false);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: /리팩터/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /리팩터/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /리팩터/ }));
    expect(screen.getByTestId("screen")).toHaveTextContent("리팩터");
    expect(screen.getByTestId("screen")).toHaveAttribute("data-wide", "true");
    expect(screen.getByRole("button", { name: /테스트/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /리팩터/ })).toHaveAttribute("aria-current", "true");
  });

  it("replaces the list with the session on a narrow screen", () => {
    useScreen(false);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: /리팩터/ }));
    expect(screen.getByTestId("screen")).toHaveAttribute("data-wide", "false");
    expect(screen.queryByRole("heading", { name: "회사PC" })).not.toBeInTheDocument();
  });

  it("switches sessions from the tab strip without stacking history, and goes back to the list", async () => {
    useScreen(false);
    render(<MobileApp />);
    connect();
    const before = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: /리팩터/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /리팩터/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /리팩터/ }));
    fireEvent.click(screen.getByRole("button", { name: "새 세션" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "회사PC" })).toBeInTheDocument());
    expect(screen.getByText("불러오는 중…")).toBeInTheDocument();
    expect(FakeSocket.last!.sent).toContainEqual({ type: "catalog" });
  });

  it("has no tab strip beside the list on a wide screen", () => {
    useScreen(true);
    render(<MobileApp />);
    connect();
    fireEvent.click(screen.getByRole("button", { name: /리팩터/ }));
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
    expect(screen.getByTestId("screen")).toHaveTextContent("리팩터");
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
    fireEvent.click(screen.getByRole("button", { name: /리팩터/ }));
    expect(screen.getByTestId("screen")).toBeInTheDocument();
    act(() => FakeSocket.last!.receive({ type: "removed", sessionId: "s1" }));
    expect(screen.queryByTestId("screen")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /테스트/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /리팩터/ })).not.toBeInTheDocument();
  });

  it("shows the list when the linked session does not exist", () => {
    useScreen(false);
    window.location.hash = "#session=gone";
    render(<MobileApp />);
    connect();
    expect(screen.queryByTestId("screen")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /리팩터/ })).toBeInTheDocument();
  });
});
