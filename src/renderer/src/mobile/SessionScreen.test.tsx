import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteClientMessage, RemoteServerMessage, RemoteSessionSummary } from "@shared/remote-types";
import type { RemoteClient } from "./remote-client";
import { SessionScreen } from "./SessionScreen";

// xterm은 jsdom에서 그려지지 않는다 — 화면이 터미널에 무엇을 붙이는지만 본다.
const keyHandlers: Array<(event: KeyboardEvent) => boolean> = [];
const focus = vi.fn();

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
    resize(): void {}
    write(): void {}
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
  keyHandlers.length = 0;
  focus.mockClear();
});

afterEach(cleanup);

describe("SessionScreen", () => {
  it("leaves the phone screen as it was: its own size toggle, tools open, keys untouched", () => {
    render(<SessionScreen client={fakeClient().client} session={SESSION} deviceId="d" onBack={vi.fn()} />);
    expect(screen.getByRole("button", { name: "📱 폰 크기로" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "세션 목록으로" })).toBeInTheDocument();
    expect(screen.getByLabelText("입력")).toBeInTheDocument();
    // 폰에 키보드를 물려도 Ctrl+V 같은 키는 전과 같이 터미널로 간다.
    expect(keyHandlers).toHaveLength(0);
    expect(focus).not.toHaveBeenCalled();
  });

  it("is a keyboard terminal on a wide screen", () => {
    render(<SessionScreen wide client={fakeClient().client} session={SESSION} deviceId="d" onBack={vi.fn()} />);
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
    const { rerender } = render(<SessionScreen wide client={client} session={SESSION} deviceId="d" onBack={vi.fn()} focusRequest={0} />);
    focus.mockClear();
    rerender(<SessionScreen wide client={client} session={SESSION} deviceId="d" onBack={vi.fn()} focusRequest={1} />);
    expect(focus).toHaveBeenCalledOnce();
    focus.mockClear();
    rerender(<SessionScreen wide focused={false} client={client} session={SESSION} deviceId="d" onBack={vi.fn()} focusRequest={2} />);
    expect(focus).not.toHaveBeenCalled();
  });

  it("offers stop for a running session and restart for a finished one", () => {
    const { client, send } = fakeClient();
    const { rerender } = render(<SessionScreen client={client} session={SESSION} deviceId="d" onBack={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "재시작" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "중지" }));
    expect(send).toHaveBeenLastCalledWith({ type: "stop", sessionId: "s1" });

    rerender(<SessionScreen client={client} session={{ ...SESSION, status: "exited" }} deviceId="d" onBack={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "중지" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "재시작" }));
    expect(send).toHaveBeenLastCalledWith({ type: "resume", sessionId: "s1" });
  });

  it("renames from a double-clicked title, and leaves it alone on Escape or no change", () => {
    const onRename = vi.fn();
    render(<SessionScreen client={fakeClient().client} session={SESSION} deviceId="d" onBack={vi.fn()} onRename={onRename} />);
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
    render(<SessionScreen client={client} session={SESSION} deviceId="d" onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(sentOf("remove")).toHaveLength(0);
    // 묻는 동안은 두 버튼만 둔다 — 폰 머리줄에 넷이 다 들어가지 않는다.
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
        onBack={vi.fn()}
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
      <SessionScreen client={client} session={{ ...SESSION, status: "exited" }} deviceId="d" onBack={vi.fn()} />,
    );
    expect(sentOf("attach")).toHaveLength(1);
    // started는 재시작을 요청한 연결에만 온다 — 다른 기기나 호스트가 재시작하면 오지 않으니 신호로 쓰지 않는다.
    act(() => deliver({ type: "started", sessionId: "s1" }));
    expect(sentOf("attach")).toHaveLength(1);
    // 목록의 상태가 "끝남"에서 벗어나는 것이 신호다. 새 프로세스의 출력은 sequence를 처음부터 세므로
    // 다시 붙어야 이전 번호에 밀려 버려지지 않는다.
    rerender(<SessionScreen client={client} session={{ ...SESSION, status: "starting" }} deviceId="d" onBack={vi.fn()} />);
    expect(sentOf("attach")).toHaveLength(2);
    rerender(<SessionScreen client={client} session={{ ...SESSION, status: "working" }} deviceId="d" onBack={vi.fn()} />);
    expect(sentOf("attach")).toHaveLength(2);
  });
});
