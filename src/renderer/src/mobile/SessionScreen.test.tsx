import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteSessionSummary } from "@shared/remote-types";
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

function fakeClient(): RemoteClient {
  return {
    onMessage: vi.fn(() => () => undefined),
    onState: vi.fn(() => () => undefined),
    send: vi.fn(() => true),
  } as unknown as RemoteClient;
}

beforeEach(() => {
  keyHandlers.length = 0;
  focus.mockClear();
});

afterEach(cleanup);

describe("SessionScreen", () => {
  it("leaves the phone screen as it was: its own size toggle, tools open, keys untouched", () => {
    render(<SessionScreen client={fakeClient()} session={SESSION} deviceId="d" onBack={vi.fn()} />);
    expect(screen.getByRole("button", { name: "📱 폰 크기로" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "세션 목록으로" })).toBeInTheDocument();
    expect(screen.getByLabelText("입력")).toBeInTheDocument();
    // 폰에 키보드를 물려도 Ctrl+V 같은 키는 전과 같이 터미널로 간다.
    expect(keyHandlers).toHaveLength(0);
    expect(focus).not.toHaveBeenCalled();
  });

  it("is a keyboard terminal on a wide screen", () => {
    render(<SessionScreen wide client={fakeClient()} session={SESSION} deviceId="d" onBack={vi.fn()} />);
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
});
