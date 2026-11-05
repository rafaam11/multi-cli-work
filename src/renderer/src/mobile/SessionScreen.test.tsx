import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { sizeMarker } from "@shared/terminal-replay";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteClientMessage, RemoteServerMessage, RemoteSessionSummary } from "@shared/remote-types";
import type { RemoteClient } from "./remote-client";
import { SessionScreen } from "./SessionScreen";

// xterm은 jsdom에서 그려지지 않는다 — 화면이 터미널에 무엇을 붙이는지만 본다.
const keyHandlers: Array<(event: KeyboardEvent) => boolean> = [];
const focus = vi.fn();
const replayHarness = vi.hoisted(() => ({ events: [] as string[], callbacks: [] as Array<() => void>, hold: false }));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: Record<string, unknown> = {};
    cols = 80;
    rows = 24;
    buffer = { active: { type: "normal", viewportY: 0, baseY: 0 } };
    loadAddon(): void {}
    open(): void {}
    focus(): void {
      focus();
    }
    reset(): void {}
    resize(cols: number, rows: number): void {
      this.cols = cols;
      this.rows = rows;
      replayHarness.events.push(`resize:${cols}x${rows}`);
    }
    write(data: string, callback?: () => void): void {
      const parse = () => {
        if (data) replayHarness.events.push(`write:${this.cols}x${this.rows}:${data}`);
        callback?.();
      };
      if (replayHarness.hold) replayHarness.callbacks.push(parse);
      else queueMicrotask(parse);
    }
    scrollLines(): void {}
    dispose(): void {}
    hasSelection(): boolean {
      return false;
    }
    onData(): { dispose(): void } {
      return { dispose: () => undefined };
    }
    onResize(): { dispose(): void } {
      return { dispose: () => undefined };
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
      keyHandlers.push(handler);
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    proposeDimensions(): { cols: number; rows: number } {
      return { cols: 100, rows: 30 };
    }
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

const SESSION: RemoteSessionSummary = {
  id: "s1",
  projectId: "p",
  projectName: "A",
  kind: "claude",
  label: "리팩터",
  status: "working",
  updatedAt: "",
};

function fakeClient() {
  const listeners = new Set<(message: RemoteServerMessage) => void>();
  const send = vi.fn((_message: RemoteClientMessage) => true);
  const client = {
    onMessage: (listener: (message: RemoteServerMessage) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onState: () => () => undefined,
    send,
  } as unknown as RemoteClient;
  const deliver = (message: RemoteServerMessage) => listeners.forEach((listener) => listener(message));
  const sentOf = (type: string) => send.mock.calls.map(([message]) => message).filter((message) => message.type === type);
  return { client, send, deliver, sentOf };
}

beforeEach(() => {
  replayHarness.events.length = 0;
  replayHarness.callbacks.length = 0;
  replayHarness.hold = false;
  keyHandlers.length = 0;
  focus.mockClear();
});

afterEach(cleanup);

describe("SessionScreen", () => {
  it("parses historical sizes before restoring the latest live size, including a split CSI", async () => {
    const { client, deliver } = fakeClient();
    const ready = vi.fn();
    render(<SessionScreen client={client} session={SESSION} deviceId="d" onReady={ready} />);
    replayHarness.hold = true;
    act(() => deliver({ type: "attached", sessionId: "s1", replay: `${sizeMarker(120, 40)}WIDE\x1b[${sizeMarker(60, 20)}2JNARROW`,
      sequence: 7, cols: 100, rows: 30, sizeOwner: "desktop" }));
    act(() => deliver({ type: "size", sessionId: "s1", cols: 90, rows: 25, sizeOwner: "desktop" }));
    act(() => deliver({ type: "data", sessionId: "s1", data: "LIVE", sequence: 8 }));
    expect(replayHarness.events).toEqual([]);
    act(() => { for (const parse of replayHarness.callbacks.splice(0)) parse(); });
    expect(replayHarness.events).toEqual([
      "resize:120x40", "write:120x40:WIDE\x1b[", "resize:60x20", "write:60x20:2JNARROW",
      "resize:90x25", "write:90x25:LIVE",
    ]);
    await waitFor(() => expect(ready).toHaveBeenLastCalledWith(true));
  });

  it("never resizes or signals ready from callbacks after the screen closes", async () => {
    const { client, deliver } = fakeClient();
    const ready = vi.fn();
    const { unmount } = render(<SessionScreen client={client} session={SESSION} deviceId="d" onReady={ready} />);
    replayHarness.hold = true;
    act(() => deliver({ type: "attached", sessionId: "s1", replay: `${sizeMarker(120, 40)}WIDE`,
      sequence: 7, cols: 100, rows: 30, sizeOwner: "desktop" }));
    unmount();
    act(() => { for (const parse of replayHarness.callbacks.splice(0)) parse(); });
    expect(replayHarness.events.filter(event => event.startsWith("resize:"))).toEqual([]);
    expect(ready).not.toHaveBeenCalledWith(true);
  });

  it("keeps the phone's chrome to one top bar, a key row and the input, without grabbing the keyboard", () => {
    render(<SessionScreen client={fakeClient().client} session={SESSION} deviceId="d" onOpenDrawer={vi.fn()} />);
    expect(screen.getByRole("button", { name: "세션 사이드바 열기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "세션 메뉴" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "빠른 키" })).toBeInTheDocument();
    expect(screen.getByLabelText("입력")).toBeInTheDocument();
    // 중지·삭제·글자 크기는 ⋯ 메뉴 안에 있다 — 화면 줄을 차지하지 않는다.
    expect(screen.queryByRole("button", { name: "중지" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "삭제" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "글자 크게" })).not.toBeInTheDocument();
    // 폰에 키보드를 물려도 Ctrl+V 같은 키는 전과 같이 터미널로 간다.
    expect(keyHandlers).toHaveLength(0);
    expect(focus).not.toHaveBeenCalled();
  });

  it("is a keyboard terminal on a wide screen", () => {
    render(<SessionScreen wide client={fakeClient().client} session={SESSION} deviceId="d" />);
    expect(screen.getByRole("button", { name: "호스트 크기 유지" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "세션 목록으로" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("입력")).not.toBeInTheDocument();
    expect(focus).toHaveBeenCalled();
    expect(keyHandlers).toHaveLength(1);
    const paste = { type: "keydown", code: "KeyV", key: "v", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };
    expect(keyHandlers[0]!(paste as unknown as KeyboardEvent)).toBe(false);
    const plain = { type: "keydown", code: "KeyA", key: "a", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    expect(keyHandlers[0]!(plain as unknown as KeyboardEvent)).toBe(true);
  });

  it("takes the keyboard back when asked again while already focused", () => {
    const { client } = fakeClient();
    const { rerender } = render(<SessionScreen wide client={client} session={SESSION} deviceId="d" focusRequest={0} />);
    focus.mockClear();
    rerender(<SessionScreen wide client={client} session={SESSION} deviceId="d" focusRequest={1} />);
    expect(focus).toHaveBeenCalledOnce();
    focus.mockClear();
    rerender(<SessionScreen wide focused={false} client={client} session={SESSION} deviceId="d" focusRequest={2} />);
    expect(focus).not.toHaveBeenCalled();
  });

  it("offers stop for a running session and restart for a finished one", () => {
    const { client, send } = fakeClient();
    const { rerender } = render(<SessionScreen wide client={client} session={SESSION} deviceId="d" />);
    expect(screen.queryByRole("button", { name: "재시작" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "중지" }));
    expect(send).toHaveBeenLastCalledWith({ type: "stop", sessionId: "s1" });

    rerender(<SessionScreen wide client={client} session={{ ...SESSION, status: "exited" }} deviceId="d" />);
    expect(screen.queryByRole("button", { name: "중지" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "재시작" }));
    expect(send).toHaveBeenLastCalledWith({ type: "resume", sessionId: "s1" });
  });

  it("renames from a double-clicked title, and leaves it alone on Escape or no change", () => {
    const onRename = vi.fn();
    render(<SessionScreen wide client={fakeClient().client} session={SESSION} deviceId="d" onRename={onRename} />);
    const title = () => screen.getByRole("heading", { name: SESSION.label });

    fireEvent.doubleClick(title());
    fireEvent.keyDown(screen.getByLabelText("세션 이름"), { key: "Escape" });
    fireEvent.doubleClick(title());
    fireEvent.submit(screen.getByLabelText("세션 이름"));
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.doubleClick(title());
    fireEvent.change(screen.getByLabelText("세션 이름"), { target: { value: "  빌드 감시  " } });
    fireEvent.submit(screen.getByLabelText("세션 이름"));
    expect(onRename).toHaveBeenCalledWith("빌드 감시");
    expect(screen.queryByLabelText("세션 이름")).not.toBeInTheDocument();
  });

  it("asks twice before removing", () => {
    const { client, sentOf } = fakeClient();
    render(<SessionScreen wide client={client} session={SESSION} deviceId="d" />);
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(sentOf("remove")).toHaveLength(0);
    // 묻는 동안은 두 버튼만 둔다 — 머리줄에 넷이 다 들어가지 않는다.
    expect(screen.queryByRole("button", { name: "중지" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("button", { name: "정말 삭제" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "중지" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    fireEvent.click(screen.getByRole("button", { name: "정말 삭제" }));
    expect(sentOf("remove")).toEqual([{ type: "remove", sessionId: "s1" }]);
  });

  it("is an icon header in a grid pane whose buttons do not move the focus first", () => {
    const { client, sentOf } = fakeClient();
    const onFocus = vi.fn();
    const onClose = vi.fn();
    const onToggleZoom = vi.fn();
    const pane = (focused: boolean) => (
      <SessionScreen
        wide
        focused={focused}
        client={client}
        session={SESSION}
        deviceId="d"
        onFocus={onFocus}
        onClose={onClose}
        onToggleZoom={onToggleZoom}
      />
    );
    const { rerender } = render(pane(false));
    // 포커스가 아닌 칸에는 크기·글자 도구가 없다.
    expect(screen.queryByRole("button", { name: "호스트 크기 유지" })).not.toBeInTheDocument();
    const close = screen.getByRole("button", { name: `${SESSION.label} 칸 닫기` });
    fireEvent.mouseDown(close);
    fireEvent.click(close);
    fireEvent.mouseDown(screen.getByRole("button", { name: "패인 확대" }));
    fireEvent.click(screen.getByRole("button", { name: "패인 확대" }));
    fireEvent.mouseDown(screen.getByRole("button", { name: "중지" }));
    fireEvent.click(screen.getByRole("button", { name: "중지" }));
    expect(onFocus).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onToggleZoom).toHaveBeenCalledOnce();
    expect(sentOf("stop")).toHaveLength(1);
    // 칸 자체를 누르면(눌렀다 떼면) 포커스를 옮긴다.
    fireEvent.mouseDown(screen.getByRole("region", { name: `${SESSION.label} 터미널` }));
    expect(onFocus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("region", { name: `${SESSION.label} 터미널` }));
    expect(onFocus).toHaveBeenCalledOnce();

    // 포커스 칸은 도구를 머리줄 안에 둔다 — 머리줄 높이가 포커스에 따라 바뀌지 않게.
    rerender(pane(true));
    expect(screen.getByRole("button", { name: "호스트 크기 유지" }).closest("header")).not.toBeNull();
    expect(screen.getByRole("button", { name: "글자 크게" }).closest("header")).not.toBeNull();
  });

  it("attaches again when its session starts running again, whoever restarted it", () => {
    const { client, deliver, sentOf } = fakeClient();
    const { rerender } = render(
      <SessionScreen client={client} session={{ ...SESSION, status: "exited" }} deviceId="d" />,
    );
    expect(sentOf("attach")).toHaveLength(1);
    // started는 재시작을 요청한 연결에만 온다 — 다른 기기나 호스트가 재시작하면 오지 않으니 신호로 쓰지 않는다.
    act(() => deliver({ type: "started", sessionId: "s1" }));
    expect(sentOf("attach")).toHaveLength(1);
    // 목록의 상태가 "끝남"에서 벗어나는 것이 신호다. 새 프로세스의 출력은 sequence를 처음부터 세므로
    // 다시 붙어야 이전 번호에 밀려 버려지지 않는다.
    rerender(<SessionScreen client={client} session={{ ...SESSION, status: "starting" }} deviceId="d" />);
    expect(sentOf("attach")).toHaveLength(2);
    rerender(<SessionScreen client={client} session={{ ...SESSION, status: "working" }} deviceId="d" />);
    expect(sentOf("attach")).toHaveLength(2);
  });
});

describe("SessionScreen on a phone", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.history.replaceState(null, "", window.location.pathname));

  const attach = (deliver: (message: RemoteServerMessage) => void) =>
    act(() => deliver({ type: "attached", sessionId: "s1", replay: "", sequence: 1, cols: 160, rows: 50, sizeOwner: "desktop" }));

  it("fits the terminal to the phone instead of drawing the PC's columns off the side", () => {
    const { client, deliver, sentOf } = fakeClient();
    render(<SessionScreen client={client} session={SESSION} deviceId="d" />);
    attach(deliver);
    // FitAddon이 이 화면에 들어간다고 잰 100×30으로 — PC의 160열이 아니라.
    expect(sentOf("resize")).toEqual([{ type: "resize", sessionId: "s1", cols: 100, rows: 30 }]);
  });

  it("says when the PC took the size back, and fits again on request", () => {
    const { client, deliver, sentOf } = fakeClient();
    render(<SessionScreen client={client} session={SESSION} deviceId="d" />);
    attach(deliver);
    act(() => deliver({ type: "size", sessionId: "s1", cols: 160, rows: 50, sizeOwner: "desktop" }));
    expect(screen.getByRole("status")).toHaveTextContent("PC가 크기를 가져갔습니다");
    fireEvent.click(screen.getByRole("button", { name: "다시 맞추기" }));
    expect(sentOf("resize")).toHaveLength(2);
    expect(screen.queryByText("PC가 크기를 가져갔습니다")).not.toBeInTheDocument();
  });

  it("gives the size back to the PC when the phone leaves a session it fitted", () => {
    const { client, deliver, sentOf } = fakeClient();
    const { unmount } = render(<SessionScreen client={client} session={SESSION} deviceId="d" />);
    attach(deliver);
    unmount();
    expect(sentOf("releaseSize")).toEqual([{ type: "releaseSize", sessionId: "s1" }]);
  });

  it("keeps the PC's size on a device that asked for it, and remembers the switch", () => {
    window.localStorage.setItem("mcw.remote.keepHostSize.v1", "1");
    const { client, deliver, sentOf } = fakeClient();
    render(<SessionScreen client={client} session={SESSION} deviceId="d" />);
    attach(deliver);
    expect(sentOf("resize")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "세션 메뉴" }));
    const keep = within(screen.getByRole("dialog", { name: "세션 메뉴" })).getByRole("switch", { name: /PC 크기 유지/ });
    expect(keep).toHaveAttribute("aria-checked", "true");
    fireEvent.click(keep);
    expect(sentOf("resize")).toEqual([{ type: "resize", sessionId: "s1", cols: 100, rows: 30 }]);
    expect(window.localStorage.getItem("mcw.remote.keepHostSize.v1")).toBe("0");
  });

  it("moves 1·2·3·Esc to the front of the key row while a session waits for approval", () => {
    const { rerender } = render(<SessionScreen client={fakeClient().client} session={SESSION} deviceId="d" />);
    const keys = () => within(screen.getByRole("group", { name: "빠른 키" })).getAllByRole("button");
    expect(keys()[0]).toHaveAccessibleName("Esc");
    rerender(<SessionScreen client={fakeClient().client} session={{ ...SESSION, status: "awaiting-approval" }} deviceId="d" />);
    expect(keys().slice(0, 4).map((key) => key.textContent)).toEqual(["1", "2", "3", "Esc"]);
    expect(keys()[0]).toHaveClass("m-key-hot");
  });

  it("sends the input with Enter and clears it", () => {
    const { client, send } = fakeClient();
    render(<SessionScreen client={client} session={SESSION} deviceId="d" />);
    fireEvent.change(screen.getByLabelText("입력"), { target: { value: "ls" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    expect(send).toHaveBeenLastCalledWith({ type: "write", sessionId: "s1", data: "ls\r" });
    expect(screen.getByLabelText("입력")).toHaveValue("");
  });

  it("stops, restarts and renames from the ⋯ menu", async () => {
    const { client, send } = fakeClient();
    const onRename = vi.fn();
    const { rerender } = render(<SessionScreen client={client} session={SESSION} deviceId="d" onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "세션 메뉴" }));
    const menu = () => within(screen.getByRole("dialog", { name: "세션 메뉴" }));
    fireEvent.click(menu().getByRole("button", { name: "이름 바꾸기" }));
    fireEvent.change(menu().getByLabelText("세션 이름"), { target: { value: "  빌드 감시  " } });
    fireEvent.click(menu().getByRole("button", { name: "저장" }));
    expect(onRename).toHaveBeenCalledWith("빌드 감시");

    fireEvent.click(menu().getByRole("button", { name: "중지" }));
    // 시트를 먼저 닫고(뒤로가기) 보낸다.
    await waitFor(() => expect(send).toHaveBeenLastCalledWith({ type: "stop", sessionId: "s1" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<SessionScreen client={client} session={{ ...SESSION, status: "exited" }} deviceId="d" onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "세션 메뉴" }));
    fireEvent.click(menu().getByRole("button", { name: "재시작" }));
    await waitFor(() => expect(send).toHaveBeenLastCalledWith({ type: "resume", sessionId: "s1" }));
  });

  it("asks twice before removing from the ⋯ menu", async () => {
    const { client, sentOf } = fakeClient();
    render(<SessionScreen client={client} session={SESSION} deviceId="d" />);
    fireEvent.click(screen.getByRole("button", { name: "세션 메뉴" }));
    const menu = within(screen.getByRole("dialog", { name: "세션 메뉴" }));
    fireEvent.click(menu.getByRole("button", { name: /^삭제/ }));
    expect(sentOf("remove")).toHaveLength(0);
    fireEvent.click(menu.getByRole("button", { name: "취소" }));
    expect(menu.queryByRole("button", { name: "정말 삭제" })).not.toBeInTheDocument();
    fireEvent.click(menu.getByRole("button", { name: /^삭제/ }));
    fireEvent.click(menu.getByRole("button", { name: "정말 삭제" }));
    await waitFor(() => expect(sentOf("remove")).toEqual([{ type: "remove", sessionId: "s1" }]));
  });

  it("closes the ⋯ menu with Back, leaving the session where it was", async () => {
    render(<SessionScreen client={fakeClient().client} session={SESSION} deviceId="d" />);
    fireEvent.click(screen.getByRole("button", { name: "세션 메뉴" }));
    expect(screen.getByRole("dialog", { name: "세션 메뉴" })).toBeInTheDocument();
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: `${SESSION.label} 터미널` })).toBeInTheDocument();
  });

  it("shows waiting sessions in the top bar and jumps to them", () => {
    const onJump = vi.fn();
    render(<SessionScreen client={fakeClient().client} session={SESSION} deviceId="d" awaiting={{ count: 2, onJump }} />);
    fireEvent.click(screen.getByRole("button", { name: "대기 2" }));
    expect(onJump).toHaveBeenCalledOnce();
  });

  it("has no top bar beside a rail — the terminal starts at the top and ⋯ floats over it", () => {
    render(<SessionScreen rail client={fakeClient().client} session={SESSION} deviceId="d" onOpenDrawer={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "세션 사이드바 열기" })).not.toBeInTheDocument();
    const more = screen.getByRole("button", { name: "세션 메뉴" });
    expect(more.closest(".m-terminal")).not.toBeNull();
  });
});
