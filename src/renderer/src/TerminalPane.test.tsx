import type { IBufferRange, ILinkHandler } from "@xterm/xterm";
import type { TerminalSessionView } from "@shared/api-types";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalPane } from "./TerminalPane";

/**
 * xterm starts at its own 80x24 default and only reaches the pane's real size once the fit addon
 * runs, so the mock reproduces that transition: `fit()` is what widens the terminal. The event log
 * records the order the pane drives it in, which is what the replay corruption hinges on.
 */
const terminalHarness = vi.hoisted(() => ({
  instances: [] as Array<{
    options: { fontSize?: number; lineHeight?: number; linkHandler?: ILinkHandler | null };
  }>,
  events: [] as string[],
  resizeObservers: [] as ResizeObserverCallback[],
  fittedCols: 200,
  fittedRows: 50,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class TerminalMock {
    cols = 80;
    rows = 24;
    paste = vi.fn();
    dispose = vi.fn();
    write = vi.fn((data: string) => {
      terminalHarness.events.push(`write:${this.cols}x${this.rows}:${data}`);
    });

    constructor(readonly options: {
      fontSize?: number;
      lineHeight?: number;
      linkHandler?: ILinkHandler | null;
    }) {
      terminalHarness.instances.push(this);
    }

    loadAddon(addon: { activate(terminal: unknown): void }) {
      addon.activate(this);
    }
    open() {}
    focus() {}
    attachCustomKeyEventHandler() {}
    getSelection() {
      return "";
    }
    onData() {
      return { dispose: () => undefined };
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddonMock {
    private terminal: { cols: number; rows: number } | null = null;

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
  render(
    <TerminalPane
      session={session}
      shiftEnterBytes={null}
      refreshRequest={0}
      onAttached={vi.fn()}
      onRefreshComplete={vi.fn()}
      {...overrides}
      onError={onError}
    />,
  );
  return { onError };
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
      onEvent: vi.fn(() => () => undefined),
    },
  } as unknown as typeof window.multiCliWork;
});

afterEach(cleanup);

describe("TerminalPane replay sizing", () => {
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

  it("keeps an exited session read-only instead of resizing its dead PTY", async () => {
    renderPane({ session: { ...session, status: "exited", exitCode: 0 } });

    await waitFor(() => expect(window.multiCliWork.terminals.attach).toHaveBeenCalled());
    expect(window.multiCliWork.terminals.resize).not.toHaveBeenCalled();
    expect(terminalHarness.events).toContain("write:200x50:REPLAY");
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
