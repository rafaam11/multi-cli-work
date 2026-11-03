import type { IBufferRange, ILinkHandler } from "@xterm/xterm";
import type { TerminalSessionView } from "@shared/api-types";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@shared/settings-types";
import { sizeMarker } from "@shared/terminal-replay";
import { TerminalPane } from "./TerminalPane";

/**
 * xterm starts at its own 80x24 default and only reaches the pane's real size once the fit addon
 * runs, so the mock reproduces that transition: `fit()` is what widens the terminal. The event log
 * records the order the pane drives it in, which is what the replay corruption hinges on.
 */
const terminalHarness = vi.hoisted(() => ({
  instances: [] as Array<{
    options: {
      fontSize?: number;
      lineHeight?: number;
      linkHandler?: ILinkHandler | null;
      fontFamily?: string;
      cursorBlink?: boolean;
      scrollback?: number;
      cursorStyle?: "bar" | "block" | "underline";
    };
  }>,
  events: [] as string[],
  resizeObservers: [] as ResizeObserverCallback[],
  fittedCols: 200,
  fittedRows: 50,
  keyHandler: null as ((event: KeyboardEvent) => boolean) | null,
  searches: [] as string[],
  searchResult: true,
  focused: 0,
  holdWrites: false,
  drainWrites: [] as Array<() => void>,
  failWriteOf: null as string | null,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class TerminalMock {
    cols = 80;
    rows = 24;
    paste = vi.fn();
    dispose = vi.fn();
    private readonly queuedWrites: Array<{ data: string; callback?: () => void }> = [];
    // Like the real one, write() only queues. Parsing, and so the callback, comes later: a resize
    // called straight after a write lands before that write, not after it.
    write = vi.fn((data: string, callback?: () => void) => {
      if (data === terminalHarness.failWriteOf) throw new Error("write failed");
      this.queuedWrites.push({ data, callback });
      if (this.queuedWrites.length > 1) return;
      const drain = () => {
        for (const queued of this.queuedWrites.splice(0)) {
          if (queued.data) terminalHarness.events.push(`write:${this.cols}x${this.rows}:${queued.data}`);
          queued.callback?.();
        }
      };
      if (terminalHarness.holdWrites) terminalHarness.drainWrites.push(drain);
      else queueMicrotask(drain);
    });

    resize(cols: number, rows: number) {
      terminalHarness.events.push(`terminal-resize:${cols}x${rows}`);
      this.cols = cols;
      this.rows = rows;
    }

    options: {
      fontSize?: number;
      lineHeight?: number;
      linkHandler?: ILinkHandler | null;
      fontFamily?: string;
      cursorBlink?: boolean;
      scrollback?: number;
      cursorStyle?: "bar" | "block" | "underline";
    };

    constructor(initialOptions: {
      fontSize?: number;
      lineHeight?: number;
      linkHandler?: ILinkHandler | null;
      fontFamily?: string;
      cursorBlink?: boolean;
      scrollback?: number;
      cursorStyle?: "bar" | "block" | "underline";
    }) {
      this.options = initialOptions;
      terminalHarness.instances.push(this);
    }

    loadAddon(addon: { activate(terminal: unknown): void }) {
      addon.activate(this);
    }
    open() {}
    focus() {
      terminalHarness.focused += 1;
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      terminalHarness.keyHandler = handler;
    }
    getSelection() {
      return "";
    }
    onData() {
      return { dispose: () => undefined };
    }
    registerLinkProvider() {
      return { dispose: () => undefined };
    }
  },
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class SearchAddonMock {
    activate() {}
    dispose() {}
    findNext(term: string, options?: { caseSensitive?: boolean }) {
      terminalHarness.searches.push(`next:${term}:${options?.caseSensitive ? "case" : "any"}`);
      return terminalHarness.searchResult;
    }
    findPrevious(term: string, options?: { caseSensitive?: boolean }) {
      terminalHarness.searches.push(`prev:${term}:${options?.caseSensitive ? "case" : "any"}`);
      return terminalHarness.searchResult;
    }
    clearDecorations() {}
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddonMock {
    private terminal: { cols: number; rows: number } | null = null;
    proposeDimensions() { return { cols: terminalHarness.fittedCols, rows: terminalHarness.fittedRows }; }

    activate(terminal: { cols: number; rows: number }) {
      this.terminal = terminal;
    }

    fit() {
      terminalHarness.events.push("fit");
      if (this.terminal) {
        this.terminal.cols = terminalHarness.fittedCols;
        this.terminal.rows = terminalHarness.fittedRows;
      }
    }

    dispose() {}
  },
}));

const session: TerminalSessionView = {
  id: "session-pwsh",
  projectId: "project-atlas",
  tool: null,
  title: null,
  name: null,
  kind: "powershell",
  cwd: "C:\\work\\atlas",
  providerConversationId: null,
  interruptedByShutdown: false,
  status: "idle",
  pid: 4100,
  exitCode: null,
  createdAt: "2026-07-11T01:00:00.000Z",
  updatedAt: "2026-07-11T01:00:00.000Z",
};

const range: IBufferRange = { start: { x: 1, y: 1 }, end: { x: 20, y: 1 } };

function renderPane(overrides: Partial<Parameters<typeof TerminalPane>[0]> = {}) {
  const onError = overrides.onError ?? vi.fn();
  const rendered = render(
    <TerminalPane
      session={session}
      settings={DEFAULT_SETTINGS.terminal}
      shiftEnterBytes={null}
      refreshRequest={0}
      onAttached={vi.fn()}
      onRefreshComplete={vi.fn()}
      {...overrides}
      onError={onError}
    />,
  );
  return { onError, container: rendered.container };
}

function linkHandler(): ILinkHandler {
  const handler = terminalHarness.instances.at(-1)?.options.linkHandler;
  if (!handler) throw new Error("terminal was created without a link handler");
  return handler;
}

beforeEach(() => {
  terminalHarness.instances.length = 0;
  terminalHarness.events.length = 0;
  terminalHarness.resizeObservers.length = 0;
  terminalHarness.fittedCols = 200;
  terminalHarness.fittedRows = 50;
  terminalHarness.keyHandler = null;
  terminalHarness.searches.length = 0;
  terminalHarness.searchResult = true;
  terminalHarness.focused = 0;
  terminalHarness.holdWrites = false;
  terminalHarness.drainWrites.length = 0;
  terminalHarness.failWriteOf = null;
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserverMock {
      constructor(private readonly listener: ResizeObserverCallback) {
        terminalHarness.resizeObservers.push(listener);
      }
      observe() {
        // A real ResizeObserver fires once as soon as it starts observing.
        this.listener([], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  window.multiCliWork = {
    shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
    clipboard: { readText: vi.fn(), writeText: vi.fn() },
    files: { pathFor: vi.fn() },
    terminals: {
      attach: vi.fn(async () => {
        terminalHarness.events.push("attach");
        return { session, replay: "REPLAY", sequence: 0 };
      }),
      refresh: vi.fn(async () => {
        terminalHarness.events.push("refresh");
        return { session, replay: "REPLAY", sequence: 0 };
      }),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn(async (_id: string, cols: number, rows: number) => {
        terminalHarness.events.push(`resize:${cols}x${rows}`);
      }),
      repaint: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => () => undefined),
    },
  } as unknown as typeof window.multiCliWork;
});

afterEach(cleanup);

describe("TerminalPane replay sizing", () => {
  describe("scrollback search", () => {
    const ctrlF = () =>
      ({ type: "keydown", key: "f", code: "KeyF", ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, preventDefault: vi.fn() }) as unknown as KeyboardEvent;

    it("opens on Ctrl+F inside the terminal and keeps the key from the PTY", () => {
      renderPane();
      let passedThrough = true;
      act(() => {
        passedThrough = terminalHarness.keyHandler!(ctrlF());
      });
      expect(passedThrough).toBe(false);
      expect(screen.getByRole("search", { name: "터미널에서 찾기" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "찾을 텍스트" })).toHaveFocus();
    });

    it("walks the matches with Enter and Shift+Enter, honouring case sensitivity", () => {
      renderPane();
      act(() => void terminalHarness.keyHandler!(ctrlF()));
      const field = screen.getByRole("textbox", { name: "찾을 텍스트" });

      fireEvent.change(field, { target: { value: "MCW" } });
      fireEvent.keyDown(field, { key: "Enter" });
      fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
      fireEvent.click(screen.getByRole("button", { name: "대소문자 구분" }));
      fireEvent.click(screen.getByRole("button", { name: "다음 결과" }));

      expect(terminalHarness.searches).toEqual(["next:MCW:any", "prev:MCW:any", "next:MCW:case"]);
    });

    it("says when nothing matches, and Escape closes it and hands the keyboard back", () => {
      terminalHarness.searchResult = false;
      renderPane();
      act(() => void terminalHarness.keyHandler!(ctrlF()));
      const field = screen.getByRole("textbox", { name: "찾을 텍스트" });
      fireEvent.change(field, { target: { value: "nope" } });
      fireEvent.keyDown(field, { key: "Enter" });
      expect(screen.getByText("결과 없음")).toBeInTheDocument();

      const before = terminalHarness.focused;
      fireEvent.keyDown(field, { key: "Escape" });
      expect(screen.queryByRole("search")).not.toBeInTheDocument();
      expect(terminalHarness.focused).toBeGreaterThan(before);
    });

    it("can be opened from the menu through the pane's command handles", () => {
      let commands: { find(): void } | null = null;
      renderPane({ onRegisterCommands: (_id, next) => (commands = next) });
      act(() => commands!.find());
      expect(screen.getByRole("search", { name: "터미널에서 찾기" })).toBeInTheDocument();
    });
  });

  it("uses the shared 13px content size and 1.25 terminal line height", () => {
    renderPane();

    expect(terminalHarness.instances.at(-1)?.options).toMatchObject({
      fontSize: 13,
      lineHeight: 1.25,
    });
  });

  it("sizes the terminal before writing the replay so scrollback is not re-wrapped", async () => {
    renderPane();

    await waitFor(() => expect(terminalHarness.events).toContain("write:200x50:REPLAY"));
    // The PTY's scrollback is stored at the size the PTY produced it. Writing it into a terminal
    // that is still at xterm's 80x24 default re-wraps every padded line, which is what the user
    // sees as extra blank lines after switching tabs and back.
    expect(terminalHarness.events).not.toContain("write:80x24:REPLAY");
    expect(terminalHarness.events.indexOf("fit")).toBeLessThan(terminalHarness.events.indexOf("attach"));
  });

  it("reports the real size to the PTY before asking for the replay", async () => {
    renderPane();

    await waitFor(() => expect(window.multiCliWork.terminals.attach).toHaveBeenCalled());
    expect(terminalHarness.events.indexOf("resize:200x50")).toBeLessThan(
      terminalHarness.events.indexOf("attach"),
    );
    expect(window.multiCliWork.terminals.resize).toHaveBeenCalledWith(session.id, 200, 50);
  });

  it("leaves the PTY alone while its pane is parked behind a zoomed one, and refits when it returns", async () => {
    const { container } = renderPane();
    await waitFor(() => expect(window.multiCliWork.terminals.attach).toHaveBeenCalled());
    vi.mocked(window.multiCliWork.terminals.resize).mockClear();
    const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

    // A parked pane is display:none — fitting it would shrink the PTY to xterm's two-column minimum.
    container.classList.add("grid-pane-parked");
    terminalHarness.resizeObservers.forEach((listener) => listener([], {} as ResizeObserver));
    await settle();
    expect(window.multiCliWork.terminals.resize).not.toHaveBeenCalled();

    container.classList.remove("grid-pane-parked");
    terminalHarness.resizeObservers.forEach((listener) => listener([], {} as ResizeObserver));
    await settle();
    expect(window.multiCliWork.terminals.resize).toHaveBeenCalledWith(session.id, 200, 50);
  });

  it("keeps an exited session read-only instead of resizing its dead PTY", async () => {
    renderPane({ session: { ...session, status: "exited", exitCode: 0 } });

    await waitFor(() => expect(window.multiCliWork.terminals.attach).toHaveBeenCalled());
    expect(window.multiCliWork.terminals.resize).not.toHaveBeenCalled();
    expect(terminalHarness.events).toContain("write:200x50:REPLAY");
  });
});

describe("TerminalPane window return", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
  const returnToWindow = () => {
    fireEvent.blur(window);
    fireEvent.focus(window);
  };
  const clearRequests = async () => {
    await settle();
    vi.mocked(window.multiCliWork.terminals.resize).mockClear();
    vi.mocked(window.multiCliWork.terminals.repaint).mockClear();
    terminalHarness.events.length = 0;
  };

  it("repaints once after returning from another window, but not on initial or repeated focus", async () => {
    renderPane();
    await clearRequests();
    fireEvent.focus(window);
    await settle();
    expect(window.multiCliWork.terminals.repaint).not.toHaveBeenCalled();
    returnToWindow();
    returnToWindow();
    await settle();
    fireEvent.focus(window);
    await settle();
    expect(window.multiCliWork.terminals.repaint).toHaveBeenCalledExactlyOnceWith(session.id);
    expect(window.multiCliWork.terminals.resize).not.toHaveBeenCalled();
    expect(terminalHarness.events).toEqual(["fit"]);
  });

  it("resizes if fitting on return finds that the pane has changed size", async () => {
    renderPane();
    await clearRequests();
    terminalHarness.fittedCols = 100;
    returnToWindow();
    await settle();
    expect(window.multiCliWork.terminals.resize).toHaveBeenCalledExactlyOnceWith(session.id, 100, 50);
    expect(window.multiCliWork.terminals.repaint).not.toHaveBeenCalled();
  });

  it("keeps a pending layout resize when a focus return joins its debounce", async () => {
    renderPane();
    await clearRequests();
    terminalHarness.resizeObservers.forEach((listener) => listener([], {} as ResizeObserver));
    returnToWindow();
    await settle();
    expect(window.multiCliWork.terminals.resize).toHaveBeenCalledExactlyOnceWith(session.id, 200, 50);
    expect(window.multiCliWork.terminals.repaint).not.toHaveBeenCalled();
  });

  it("skips panes parked behind a zoomed pane", async () => {
    const { container } = renderPane();
    await clearRequests();
    container.classList.add("grid-pane-parked");
    returnToWindow();
    await settle();
    expect(terminalHarness.events).toEqual([]);
    expect(window.multiCliWork.terminals.repaint).not.toHaveBeenCalled();
    expect(window.multiCliWork.terminals.resize).not.toHaveBeenCalled();
  });

  it("skips exited sessions", async () => {
    renderPane({ session: { ...session, status: "exited", exitCode: 0 } });
    await clearRequests();
    returnToWindow();
    await settle();
    expect(terminalHarness.events).toEqual([]);
    expect(window.multiCliWork.terminals.repaint).not.toHaveBeenCalled();
    expect(window.multiCliWork.terminals.resize).not.toHaveBeenCalled();
  });

  it("removes window handlers and cancels a pending repaint when closed", async () => {
    const { unmount } = render(<TerminalPane session={session} settings={DEFAULT_SETTINGS.terminal}
      shiftEnterBytes={null} refreshRequest={0} onAttached={vi.fn()} onRefreshComplete={vi.fn()} onError={vi.fn()} />);
    await clearRequests();
    returnToWindow();
    unmount();
    returnToWindow();
    await settle();
    expect(terminalHarness.events).toEqual([]);
    expect(window.multiCliWork.terminals.repaint).not.toHaveBeenCalled();
    expect(window.multiCliWork.terminals.resize).not.toHaveBeenCalled();
  });
});

describe("TerminalPane sized replay", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 60));
  const fireResizeObservers = () =>
    terminalHarness.resizeObservers.forEach((listener) => listener([], {} as ResizeObserver));
  const attachesTo = (replay: string, sequence = 0) =>
    vi.mocked(window.multiCliWork.terminals.attach).mockImplementationOnce(async () => {
      terminalHarness.events.push("attach");
      return { session, replay, sequence };
    });
  const queuedWrites = async () => {
    await waitFor(() => expect(terminalHarness.drainWrites.length).toBeGreaterThan(0));
  };
  const parseWrites = () =>
    act(() => {
      terminalHarness.holdWrites = false;
      for (const drain of terminalHarness.drainWrites.splice(0)) drain();
    });

  it("writes each part of the replay at the size it was written at", async () => {
    attachesTo(`${sizeMarker(120, 40)}WIDE${sizeMarker(60, 20)}NARROW`);

    renderPane();

    await waitFor(() => expect(terminalHarness.events).toContain("write:60x20:NARROW"));
    const replayed = terminalHarness.events.filter((event) => /^(terminal-resize|write):/.test(event));
    expect(replayed).toEqual([
      "terminal-resize:120x40",
      "write:120x40:WIDE",
      "terminal-resize:60x20",
      "write:60x20:NARROW",
    ]);
  });

  it("fits the pane after the last part of the replay, not before it", async () => {
    attachesTo(`${sizeMarker(120, 40)}WIDE`);

    renderPane();

    await waitFor(() => expect(terminalHarness.events.at(-1)).toBe("resize:200x50"));
    const wide = terminalHarness.events.indexOf("write:120x40:WIDE");
    expect(wide).toBeGreaterThan(-1);
    expect(terminalHarness.events.slice(wide + 1)).toEqual(["fit", "resize:200x50"]);
  });

  it("asks the PTY to redraw after a replay that did not change the size, which is what repairs a garbled screen", async () => {
    renderPane();

    await waitFor(() => expect(terminalHarness.events).toContain("write:200x50:REPLAY"));
    await waitFor(() => expect(terminalHarness.events.at(-1)).toBe("resize:200x50"));
    expect(terminalHarness.events.indexOf("write:200x50:REPLAY")).toBeLessThan(
      terminalHarness.events.lastIndexOf("resize:200x50"),
    );
  });

  it("leaves the terminal at the replay's sizes when the pane changes while it is still being parsed", async () => {
    terminalHarness.holdWrites = true;
    attachesTo(`${sizeMarker(120, 40)}WIDE`);
    renderPane();
    await queuedWrites();
    await settle();
    terminalHarness.events.length = 0;

    fireResizeObservers();
    await settle();
    expect(terminalHarness.events).toEqual([]);

    parseWrites();
    await waitFor(() => expect(terminalHarness.events.at(-1)).toBe("resize:200x50"));
    expect(terminalHarness.events).toContain("write:120x40:WIDE");
  });

  it("says it is connecting until the replay has been parsed", async () => {
    terminalHarness.holdWrites = true;
    renderPane();
    await queuedWrites();
    await settle();
    expect(screen.getByText("세션 연결 중")).toBeInTheDocument();

    parseWrites();

    await waitFor(() => expect(screen.queryByText("세션 연결 중")).not.toBeInTheDocument());
  });

  it("keeps output that arrives during the replay behind it", async () => {
    terminalHarness.holdWrites = true;
    attachesTo(`${sizeMarker(120, 40)}WIDE`, 7);
    renderPane();
    await queuedWrites();
    await settle();
    const listener = vi.mocked(window.multiCliWork.terminals.onEvent).mock.calls[0][0];

    listener({ type: "data", sessionId: session.id, data: "LIVE", sequence: 8 });
    parseWrites();

    // The PTY was already at the pane's size when it produced this, so that is the size to read it at.
    await waitFor(() => expect(terminalHarness.events).toContain("write:200x50:LIVE"));
    expect(terminalHarness.events.indexOf("write:120x40:WIDE")).toBeLessThan(
      terminalHarness.events.indexOf("write:200x50:LIVE"),
    );
  });

  it("does nothing to a terminal that was closed before its replay finished", async () => {
    terminalHarness.holdWrites = true;
    attachesTo(`${sizeMarker(120, 40)}WIDE`);
    const { unmount } = render(
      <TerminalPane
        session={session}
        settings={DEFAULT_SETTINGS.terminal}
        shiftEnterBytes={null}
        refreshRequest={0}
        onAttached={vi.fn()}
        onRefreshComplete={vi.fn()}
        onError={vi.fn()}
      />,
    );
    await queuedWrites();
    await settle();
    unmount();
    terminalHarness.events.length = 0;

    // The real xterm still calls these back after dispose().
    parseWrites();
    await settle();

    expect(terminalHarness.events.filter((event) => !event.startsWith("write:"))).toEqual([]);
  });

  it("keeps saying it is connecting when the replay of the terminal it replaced finishes first", async () => {
    terminalHarness.holdWrites = true;
    const pane = (refreshRequest: number) => (
      <TerminalPane
        session={session}
        settings={DEFAULT_SETTINGS.terminal}
        shiftEnterBytes={null}
        refreshRequest={refreshRequest}
        onAttached={vi.fn()}
        onRefreshComplete={vi.fn()}
        onError={vi.fn()}
      />
    );
    const { rerender } = render(pane(0));
    await queuedWrites();
    rerender(pane(1));
    await waitFor(() => expect(terminalHarness.drainWrites).toHaveLength(2));
    await settle();

    // The real xterm still calls these back after dispose().
    const [parseReplacedTerminal] = terminalHarness.drainWrites;
    act(() => parseReplacedTerminal());
    await settle();

    expect(screen.getByText("세션 연결 중")).toBeInTheDocument();
  });

  it("goes on fitting the pane after a replay that could not be written", async () => {
    terminalHarness.failWriteOf = "WIDE";
    attachesTo(`${sizeMarker(120, 40)}WIDE`);
    const { onError } = renderPane();
    await waitFor(() => expect(onError).toHaveBeenCalledWith("write failed"));
    await settle();
    vi.mocked(window.multiCliWork.terminals.resize).mockClear();

    fireResizeObservers();
    await settle();

    expect(window.multiCliWork.terminals.resize).toHaveBeenCalledWith(session.id, 200, 50);
  });
});

describe("TerminalPane link handling", () => {
  it("opens a clicked terminal link in the external browser instead of xterm's blocked popup", () => {
    const openWindow = vi.fn();
    const confirmDialog = vi.fn(() => true);
    vi.stubGlobal("open", openWindow);
    vi.stubGlobal("confirm", confirmDialog);

    renderPane();
    linkHandler().activate(new MouseEvent("click"), "https://example.com/docs", range);

    expect(window.multiCliWork.shell.openExternal).toHaveBeenCalledWith("https://example.com/docs");
    // xterm's built-in handler confirms and then calls window.open(), which the main process denies.
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("reports a failed open through onError", async () => {
    const { onError } = renderPane();
    vi.mocked(window.multiCliWork.shell.openExternal).mockRejectedValueOnce(new Error("no browser"));

    linkHandler().activate(new MouseEvent("click"), "https://example.com/docs", range);

    await waitFor(() => expect(onError).toHaveBeenCalledWith("no browser"));
  });
});

describe("TerminalPane settings", () => {
  it("설정 변경이 살아있는 터미널에 재생성 없이 반영된다", () => {
    const { rerender } = render(
      <TerminalPane
        session={session}
        settings={DEFAULT_SETTINGS.terminal}
        shiftEnterBytes={null}
        refreshRequest={0}
        onAttached={vi.fn()}
        onRefreshComplete={vi.fn()}
        onError={vi.fn()}
      />,
    );
    const terminal = terminalHarness.instances.at(-1)!;
    expect(terminal.options.fontSize).toBe(13);

    rerender(
      <TerminalPane
        session={session}
        settings={{ ...DEFAULT_SETTINGS.terminal, fontSize: 20, cursorBlink: true, scrollback: 50_000 }}
        shiftEnterBytes={null}
        refreshRequest={0}
        onAttached={vi.fn()}
        onRefreshComplete={vi.fn()}
        onError={vi.fn()}
      />,
    );

    expect(terminal.options.fontSize).toBe(20);
    expect(terminal.options.cursorBlink).toBe(true);
    expect(terminal.options.scrollback).toBe(50_000);
    expect(terminalHarness.instances.length).toBe(1); // 재생성 없음 = 스크롤백·상태 보존
  });
});
