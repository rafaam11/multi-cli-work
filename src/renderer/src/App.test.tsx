import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AppStateSnapshot } from "@shared/app-state-types";
import type { MultiCliWorkApi, ProjectWorkspaceSnapshot, TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { TerminalWorkerEvent } from "@shared/terminal-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const terminalHarness = vi.hoisted(() => ({
  instances: [] as Array<{
    cols: number;
    rows: number;
    write: ReturnType<typeof vi.fn>;
    paste: ReturnType<typeof vi.fn>;
    emitInput(data: string): void;
    emitKey(event: Partial<KeyboardEvent>): boolean;
    selection: string;
  }>,
  fit: vi.fn(),
  resizeObservers: [] as ResizeObserverCallback[],
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class TerminalMock {
    cols = 96;
    rows = 28;
    write = vi.fn();
    paste = vi.fn();
    selection = "";
    private readonly inputListeners = new Set<(data: string) => void>();
    private keyHandler: ((event: KeyboardEvent) => boolean) | null = null;

    constructor() {
      terminalHarness.instances.push(this);
    }

    loadAddon() {}
    open() {}
    focus() {}
    dispose() {}

    onData(listener: (data: string) => void) {
      this.inputListeners.add(listener);
      return { dispose: () => this.inputListeners.delete(listener) };
    }

    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      this.keyHandler = handler;
    }

    getSelection() {
      return this.selection;
    }

    emitInput(data: string) {
      for (const listener of this.inputListeners) listener(data);
    }

    emitKey(event: Partial<KeyboardEvent>) {
      return this.keyHandler?.(event as KeyboardEvent) ?? true;
    }
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class FitAddonMock {
    fit = terminalHarness.fit;
    dispose() {}
  },
}));

const atlas: SharedProject = {
  id: "project-atlas",
  rootPath: "C:\\work\\atlas",
  displayName: "Atlas",
  sources: ["manual", "codex"],
  providerRefs: { claude: [], codex: ["codex:atlas"] },
  status: "진행중",
  memo: "",
  tracks: [],
  hidden: false,
  order: 0,
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T01:00:00.000Z",
};

const dashboard: SharedProject = {
  ...atlas,
  id: "project-dashboard",
  rootPath: "C:\\work\\dashboard",
  displayName: "Dashboard",
  providerRefs: { claude: ["dashboard"], codex: [] },
  order: 1,
};

const powershellSession: TerminalSessionView = {
  id: "session-pwsh",
  projectId: atlas.id,
  kind: "powershell",
  cwd: atlas.rootPath,
  providerConversationId: null,
  status: "idle",
  pid: 4100,
  exitCode: null,
  createdAt: "2026-07-11T01:00:00.000Z",
  updatedAt: "2026-07-11T01:00:00.000Z",
};

const claudeSession: TerminalSessionView = {
  ...powershellSession,
  id: "session-claude",
  kind: "claude",
  providerConversationId: "claude-conversation",
  status: "exited",
  pid: null,
  exitCode: 0,
  createdAt: "2026-07-11T02:00:00.000Z",
  updatedAt: "2026-07-11T02:30:00.000Z",
};

function registry(projects: SharedProject[] = [atlas]): ProjectWorkspaceSnapshot {
  return {
    source: "primary",
    writable: true,
    missingRootProjectIds: [],
    registry: {
      schemaVersion: 1,
      updatedAt: "2026-07-11T03:00:00.000Z",
      projects: Object.fromEntries(projects.map((project) => [project.id, project])),
    },
  };
}

function createApi(options?: {
  projects?: SharedProject[];
  sessions?: TerminalSessionView[];
  warning?: string;
  source?: ProjectWorkspaceSnapshot["source"];
  writable?: boolean;
  missingRootProjectIds?: string[];
  refreshError?: Error;
  selection?: Pick<AppStateSnapshot["state"], "selectedProjectId" | "selectedSessionId">;
}) {
  const listeners = new Set<(event: TerminalWorkerEvent) => void>();
  const projects = options?.projects ?? [atlas];
  const sessions = options?.sessions ?? [powershellSession, claudeSession];
  const snapshot = {
    ...registry(projects),
    source: options?.source ?? "primary",
    writable: options?.writable ?? true,
    warning: options?.warning,
    missingRootProjectIds: options?.missingRootProjectIds ?? [],
  };
  const created: TerminalSessionView = {
    ...powershellSession,
    id: "session-new",
    status: "starting",
    pid: 4200,
    createdAt: "2026-07-11T04:00:00.000Z",
    updatedAt: "2026-07-11T04:00:00.000Z",
  };
  let resumedSession: TerminalSessionView | null = null;
  const appState: AppStateSnapshot = {
    source: "primary",
    writable: true,
    state: {
      schemaVersion: 1,
      updatedAt: "2026-07-11T04:00:00.000Z",
      selectedProjectId: options?.selection?.selectedProjectId ?? atlas.id,
      selectedSessionId: options?.selection?.selectedSessionId ?? sessions[0]?.id ?? null,
      sessions: {},
    },
  };

  const api: MultiCliWorkApi = {
    platform: "win32",
    projects: {
      list: vi.fn().mockResolvedValue(snapshot),
      refresh: options?.refreshError
        ? vi.fn().mockRejectedValue(options.refreshError)
        : vi.fn().mockResolvedValue(snapshot),
      addFolder: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      relink: vi.fn().mockResolvedValue(null),
    },
    providers: {
      availability: vi.fn().mockResolvedValue({ powershell: true, claude: true, codex: false }),
    },
    terminals: {
      list: vi.fn().mockResolvedValue(sessions),
      state: vi.fn().mockResolvedValue(appState),
      create: vi.fn().mockResolvedValue(created),
      attach: vi.fn().mockImplementation(async (sessionId: string) => ({
        session: sessionId === claudeSession.id ? resumedSession ?? claudeSession : sessionId === created.id ? created : powershellSession,
        replay: `${sessionId} replay\r\n`,
        sequence: 0,
      })),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockImplementation(async () => {
        resumedSession = { ...claudeSession, status: "starting", pid: 4300, exitCode: null };
        return resumedSession;
      }),
      remove: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockResolvedValue({
        source: "primary",
        writable: true,
        state: {
          schemaVersion: 1,
          updatedAt: "2026-07-11T04:00:00.000Z",
          selectedProjectId: atlas.id,
          selectedSessionId: powershellSession.id,
          sessions: {},
        },
      }),
      onEvent: vi.fn((listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    },
  };

  return {
    api,
    created,
    emit(event: TerminalWorkerEvent) {
      for (const listener of listeners) listener(event);
    },
  };
}

beforeEach(() => {
  terminalHarness.instances.length = 0;
  terminalHarness.fit.mockReset();
  terminalHarness.resizeObservers.length = 0;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024, writable: true });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      readText: vi.fn().mockResolvedValue("clipboard paste"),
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserverMock {
      constructor(private readonly listener: ResizeObserverCallback) {
        terminalHarness.resizeObservers.push(listener);
      }
      observe() {
        this.listener([], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    },
  );
});

afterEach(cleanup);

describe("project workspace", () => {
  it("loads discovered projects and nested terminal sessions", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;

    render(<App />);

    expect(screen.getAllByText("Loading workspace")).toHaveLength(2);
    expect(await screen.findByRole("button", { name: "Select project Atlas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open PowerShell session" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Claude Code session" })).toBeInTheDocument();
    expect(screen.getAllByText("C:\\work\\atlas")).toHaveLength(2);
    expect(harness.api.projects.list).toHaveBeenCalledOnce();
    expect(harness.api.projects.refresh).toHaveBeenCalledOnce();
    expect(harness.api.terminals.list).toHaveBeenCalledOnce();
    expect(harness.api.terminals.state).toHaveBeenCalledOnce();
    expect(harness.api.providers.availability).toHaveBeenCalledOnce();
  });

  it("restores a persisted project and session selection when both still exist", async () => {
    const dashboardSession: TerminalSessionView = {
      ...powershellSession,
      id: "session-dashboard",
      projectId: dashboard.id,
      cwd: dashboard.rootPath,
    };
    const harness = createApi({
      projects: [atlas, dashboard],
      sessions: [powershellSession, dashboardSession],
      selection: { selectedProjectId: dashboard.id, selectedSessionId: dashboardSession.id },
    });
    window.multiCliWork = harness.api;

    render(<App />);

    const selectedProject = await screen.findByRole("button", { name: "Select project Dashboard" });
    expect(selectedProject.closest(".project-row")).toHaveClass("selected");
    expect(document.querySelector(".session-row.selected")).toHaveAttribute("aria-label", "Open PowerShell session");
    expect(document.querySelector(".workspace-title")).toHaveTextContent("Dashboard");
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalledWith(dashboardSession.id));
  });

  it("persists selection and creates only available provider sessions", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Select project Atlas" }));
    fireEvent.click(screen.getByRole("button", { name: "New session" }));

    expect(screen.getByRole("menuitem", { name: "New Codex session" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "New PowerShell session" }));

    await waitFor(() =>
      expect(harness.api.terminals.create).toHaveBeenCalledWith({
        projectId: atlas.id,
        kind: "powershell",
        cols: 80,
        rows: 24,
      }),
    );
    expect(harness.api.terminals.select).toHaveBeenCalledWith(atlas.id, harness.created.id);
    expect((await screen.findAllByText("Starting")).length).toBeGreaterThan(0);
  });

  it("manually resumes, stops, and removes a finished session", async () => {
    const harness = createApi({ sessions: [claudeSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Open Claude Code session" }));
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalledWith(claudeSession.id));
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    expect(harness.api.terminals.resize).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Resume session" }));
    await waitFor(() =>
      expect(harness.api.terminals.resume).toHaveBeenCalledWith({
        sessionId: claudeSession.id,
        cols: 80,
        rows: 24,
      }),
    );
    await waitFor(() =>
      expect(harness.api.terminals.resize).toHaveBeenCalledWith(claudeSession.id, 96, 28),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Stop session" }));
    expect(harness.api.terminals.stop).toHaveBeenCalledWith(claudeSession.id);

    await act(async () => {
      harness.emit({ type: "exit", sessionId: claudeSession.id, exitCode: 0 });
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove session" }));
    await waitFor(() => expect(harness.api.terminals.remove).toHaveBeenCalledWith(claudeSession.id));
    expect(harness.api.terminals.select).toHaveBeenLastCalledWith(atlas.id, null);
    expect(screen.getByText("Start a session in Atlas")).toBeInTheDocument();
  });

  it("keeps the terminal in a dedicated flexible workspace body", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    const terminalRegion = await screen.findByRole("region", { name: "powershell terminal" });
    expect(terminalRegion.parentElement).toHaveClass("workspace-body");
  });

  it("attaches replay, forwards input and live output, and resizes the PTY", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Open PowerShell session" }));
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalledWith(powershellSession.id));
    const terminal = terminalHarness.instances.at(-1)!;
    expect(terminal.write).toHaveBeenCalledWith(`${powershellSession.id} replay\r\n`);

    terminal.emitInput("Get-Location\r");
    expect(harness.api.terminals.write).toHaveBeenCalledWith(powershellSession.id, "Get-Location\r");

    await act(async () => {
      harness.emit({ type: "data", sessionId: powershellSession.id, data: "C:\\work\\atlas\r\n", sequence: 1 });
    });
    expect(terminal.write).toHaveBeenCalledWith("C:\\work\\atlas\r\n");
    await waitFor(() => expect(harness.api.terminals.resize).toHaveBeenCalledWith(powershellSession.id, 96, 28));
  });

  it("does not duplicate live output that is already included in attach replay", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    let resolveAttach!: (value: Awaited<ReturnType<MultiCliWorkApi["terminals"]["attach"]>>) => void;
    vi.mocked(harness.api.terminals.attach).mockImplementation(
      () => new Promise((resolve) => { resolveAttach = resolve; }),
    );
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "powershell terminal" });
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalled());
    const terminal = terminalHarness.instances.at(-1)!;
    await act(async () => {
      harness.emit({ type: "data", sessionId: powershellSession.id, data: "during attach\r\n", sequence: 2 });
      resolveAttach({
        session: powershellSession,
        replay: "before\r\nduring attach\r\n",
        sequence: 2,
      });
    });

    await waitFor(() => expect(terminal.write).toHaveBeenCalledWith("before\r\nduring attach\r\n"));
    expect(terminal.write).not.toHaveBeenCalledWith("during attach\r\n");

    await act(async () => {
      harness.emit({ type: "data", sessionId: powershellSession.id, data: "after attach\r\n", sequence: 3 });
    });
    expect(terminal.write).toHaveBeenCalledWith("after attach\r\n");
  });

  it("maps Ctrl+Shift+C and Ctrl+Shift+V to the system clipboard without consuming normal terminal keys", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "powershell terminal" });
    const terminal = terminalHarness.instances.at(-1)!;
    terminal.selection = "selected output";

    expect(terminal.emitKey({ type: "keydown", ctrlKey: true, shiftKey: true, code: "KeyC" })).toBe(false);
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("selected output"));

    vi.mocked(harness.api.terminals.write).mockClear();
    expect(terminal.emitKey({ type: "keydown", ctrlKey: true, shiftKey: true, code: "KeyV" })).toBe(false);
    await waitFor(() => expect(terminal.paste).toHaveBeenCalledWith("clipboard paste"));
    expect(harness.api.terminals.write).not.toHaveBeenCalled();
    expect(terminal.emitKey({ type: "keydown", ctrlKey: true, code: "KeyC" })).toBe(true);
  });

  it("does not resize after a running session transitions to exited", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("region", { name: "powershell terminal" });
    await waitFor(() => expect(harness.api.terminals.resize).toHaveBeenCalled());
    vi.mocked(harness.api.terminals.resize).mockClear();

    await act(async () => {
      harness.emit({ type: "exit", sessionId: powershellSession.id, exitCode: 0 });
    });
    for (const observer of terminalHarness.resizeObservers) {
      observer([], {} as ResizeObserver);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 60));

    expect(harness.api.terminals.resize).not.toHaveBeenCalled();
  });

  it("keeps backup registry data visible when provider discovery refresh fails", async () => {
    const harness = createApi({
      source: "backup",
      writable: false,
      warning: "Registry backup is in use.",
      refreshError: new Error("Provider discovery unavailable"),
    });
    window.multiCliWork = harness.api;

    render(<App />);

    expect(await screen.findByRole("button", { name: "Select project Atlas" })).toBeInTheDocument();
    expect(screen.getByText(/Registry backup is in use/)).toBeInTheDocument();
    expect(screen.getByText(/Provider discovery unavailable/)).toBeInTheDocument();
    expect(screen.queryByText("Workspace could not be loaded")).not.toBeInTheDocument();
  });

  it("marks missing project roots, offers relink, and disables new sessions until relinked", async () => {
    const harness = createApi({ missingRootProjectIds: [atlas.id] });
    vi.mocked(harness.api.projects.relink).mockResolvedValue({ ...atlas, rootPath: "D:\\restored\\atlas" });
    window.multiCliWork = harness.api;
    render(<App />);

    expect(await screen.findByText("Project folder is missing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New session" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Relink project folder" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Relink project folder" }));
    await waitFor(() => expect(harness.api.projects.relink).toHaveBeenCalledWith(atlas.id));
    expect(screen.queryByText("Project folder is missing")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New session" })).toBeEnabled();
  });

  it("clamps a draggable sidebar between stable minimum and viewport-aware maximum widths", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("button", { name: "Select project Atlas" });
    const separator = screen.getByRole("separator", { name: "Resize project sidebar" });
    const shell = separator.parentElement!;

    fireEvent.mouseDown(separator, { clientX: 260 });
    fireEvent.mouseMove(window, { clientX: 800 });
    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("416px");
    fireEvent.mouseMove(window, { clientX: 40 });
    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("200px");
    fireEvent.mouseUp(window);
  });

  it("shows actionable empty, warning, and load-error states", async () => {
    const emptyHarness = createApi({ projects: [], sessions: [], warning: "Registry backup is in use." });
    window.multiCliWork = emptyHarness.api;
    const view = render(<App />);

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Registry backup is in use.");

    view.unmount();
    const retryHarness = createApi();
    vi.mocked(retryHarness.api.projects.list)
      .mockRejectedValueOnce(new Error("Registry unavailable"))
      .mockResolvedValueOnce(registry());
    window.multiCliWork = retryHarness.api;
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Registry unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Select project Atlas" })).toBeInTheDocument();
  });
});
