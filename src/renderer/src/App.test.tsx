import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  tool: null,
  kind: "powershell",
  cwd: atlas.rootPath,
  providerConversationId: null,
  status: "idle",
  pid: 4100,
  exitCode: null,
  createdAt: "2026-07-11T01:00:00.000Z",
  updatedAt: "2026-07-11T01:00:00.000Z",
};

const toolSession: TerminalSessionView = {
  ...powershellSession,
  id: "session-tool",
  projectId: null,
  tool: "claude-update",
  cwd: "C:\\Users\\me",
  createdAt: "2026-07-11T05:00:00.000Z",
  updatedAt: "2026-07-11T05:00:00.000Z",
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
      addFolder: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      remove: vi.fn().mockImplementation(async (projectId: string) => registry(projects.filter((project) => project.id !== projectId))),
      relink: vi.fn().mockResolvedValue(null),
      restoreBackup: vi.fn().mockResolvedValue(registry(projects)),
      reveal: vi.fn().mockResolvedValue(undefined),
      openInEditor: vi.fn().mockResolvedValue(undefined),
      openOnGitHub: vi.fn().mockResolvedValue(undefined),
    },
    providers: {
      availability: vi.fn().mockResolvedValue({ powershell: true, claude: true, codex: false, vscode: true }),
    },
    terminals: {
      list: vi.fn().mockResolvedValue(sessions),
      state: vi.fn().mockResolvedValue(appState),
      create: vi.fn().mockResolvedValue(created),
      createTool: vi.fn().mockResolvedValue(toolSession),
      attach: vi.fn().mockImplementation(async (sessionId: string) => {
        const known = [...sessions, created, toolSession].find((session) => session.id === sessionId);
        return {
          session: sessionId === claudeSession.id ? (resumedSession ?? claudeSession) : (known ?? powershellSession),
          replay: `${sessionId} replay\r\n`,
          sequence: 0,
        };
      }),
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
    updates: {
      appVersion: vi.fn().mockResolvedValue("1.0.0"),
      status: vi.fn().mockResolvedValue({ state: "idle" }),
      check: vi.fn().mockResolvedValue(undefined),
      install: vi.fn().mockResolvedValue(undefined),
      openReleases: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => () => undefined),
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

describe("folder workspace", () => {
  it("loads opened folders and nested terminal sessions", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;

    render(<App />);

    expect(screen.getAllByText("Loading workspace")).toHaveLength(2);
    expect(await screen.findByRole("button", { name: "Select folder Atlas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open PowerShell session" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Claude Code session" })).toBeInTheDocument();
    expect(screen.getAllByText("C:\\work\\atlas")).toHaveLength(2);
    expect(harness.api.projects.list).toHaveBeenCalledOnce();
    expect(harness.api.terminals.list).toHaveBeenCalledOnce();
    expect(harness.api.terminals.state).toHaveBeenCalledOnce();
    expect(harness.api.providers.availability).toHaveBeenCalledOnce();
  });

  it("gives same-provider sessions stable visible and accessible ordinals", async () => {
    const secondPowerShell: TerminalSessionView = {
      ...powershellSession,
      id: "session-pwsh-second",
      createdAt: "2026-07-11T03:00:00.000Z",
      updatedAt: "2026-07-11T03:00:00.000Z",
    };
    const harness = createApi({ sessions: [secondPowerShell, powershellSession] });
    window.multiCliWork = harness.api;

    render(<App />);

    expect(await screen.findByRole("button", { name: "Open PowerShell 1 session" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open PowerShell 2 session" })).toBeInTheDocument();
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

    const selectedProject = await screen.findByRole("button", { name: "Select folder Dashboard" });
    expect(selectedProject.closest(".project-row")).toHaveClass("selected");
    expect(document.querySelector(".session-row.selected")).toHaveAttribute("aria-label", "Open PowerShell session");
    expect(document.querySelector(".workspace-title")).toHaveTextContent("Dashboard");
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalledWith(dashboardSession.id));
  });

  it("renders a refresh button that reloads folders and sessions on click", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Select folder Atlas" });
    expect(harness.api.projects.list).toHaveBeenCalledOnce();

    const refreshButton = screen.getByRole("button", { name: "Refresh folders" });
    fireEvent.click(refreshButton);
    expect(refreshButton).toBeDisabled();

    await waitFor(() => expect(harness.api.projects.list).toHaveBeenCalledTimes(2));
    expect(harness.api.terminals.list).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(refreshButton).toBeEnabled());
  });

  it("keeps the selected folder and session across a manual refresh when they still exist", async () => {
    const dashboardSession: TerminalSessionView = {
      ...powershellSession,
      id: "session-dashboard",
      projectId: dashboard.id,
      cwd: dashboard.rootPath,
    };
    // appState stays pinned to Atlas/PowerShell throughout, simulating stale persisted state.
    const harness = createApi({
      projects: [atlas, dashboard],
      sessions: [powershellSession, dashboardSession],
    });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Select folder Atlas" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse Atlas" }));
    fireEvent.click(screen.getByRole("button", { name: "Select folder Dashboard" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open PowerShell session" }));

    fireEvent.click(screen.getByRole("button", { name: "Refresh folders" }));
    await waitFor(() => expect(harness.api.projects.list).toHaveBeenCalledTimes(2));

    expect(screen.getByRole("button", { name: "Select folder Dashboard" }).closest(".project-row")).toHaveClass(
      "selected",
    );
    expect(document.querySelector(".session-row.selected")).toHaveAttribute("aria-label", "Open PowerShell session");
    expect(document.querySelector(".workspace-title")).toHaveTextContent("Dashboard");
  });

  it("falls back to another folder when the selected folder disappears during a manual refresh", async () => {
    const harness = createApi({ projects: [atlas, dashboard], sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Select folder Atlas" });
    expect(screen.getByRole("button", { name: "Select folder Atlas" }).closest(".project-row")).toHaveClass("selected");

    vi.mocked(harness.api.projects.list).mockResolvedValueOnce(registry([dashboard]));
    fireEvent.click(screen.getByRole("button", { name: "Refresh folders" }));

    await waitFor(() => expect(harness.api.projects.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Select folder Atlas" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select folder Dashboard" }).closest(".project-row")).toHaveClass(
      "selected",
    );
  });

  it("offers a restore action when the registry fell back to its backup", async () => {
    const harness = createApi({
      writable: false,
      source: "backup",
      warning: "Primary project registry is invalid: bad json",
    });
    window.multiCliWork = harness.api;
    render(<App />);

    const restoreButton = await screen.findByRole("button", { name: "Restore registry from backup" });
    fireEvent.click(restoreButton);

    await waitFor(() => expect(harness.api.projects.restoreBackup).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Restore registry from backup" })).not.toBeInTheDocument(),
    );
  });

  it("renames a folder from the context menu and updates the tree", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    vi.mocked(harness.api.projects.update).mockResolvedValue({ ...atlas, displayName: "Atlas Prime" });
    render(<App />);

    const row = await screen.findByRole("button", { name: "Select folder Atlas" });
    fireEvent.contextMenu(row.closest(".project-row")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    const editor = screen.getByRole("dialog", { name: "Rename Atlas" });
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Atlas Prime" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(harness.api.projects.update).toHaveBeenCalledWith(atlas.id, { displayName: "Atlas Prime" }),
    );
    await screen.findByRole("button", { name: "Select folder Atlas Prime" });
    expect(editor).not.toBeInTheDocument();
  });

  it("opens a folder in the file explorer, VS Code, and GitHub from the context menu", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    const row = (await screen.findByRole("button", { name: "Select folder Atlas" })).closest(".project-row")!;

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in File Explorer" }));
    await waitFor(() => expect(harness.api.projects.reveal).toHaveBeenCalledWith(atlas.id));

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in VS Code" }));
    await waitFor(() => expect(harness.api.projects.openInEditor).toHaveBeenCalledWith(atlas.id));

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open on GitHub" }));
    await waitFor(() => expect(harness.api.projects.openOnGitHub).toHaveBeenCalledWith(atlas.id));
  });

  it("disables the VS Code action when VS Code is not installed", async () => {
    const harness = createApi();
    vi.mocked(harness.api.providers.availability).mockResolvedValue({
      powershell: true,
      claude: true,
      codex: false,
      vscode: false,
    });
    window.multiCliWork = harness.api;
    render(<App />);

    const row = (await screen.findByRole("button", { name: "Select folder Atlas" })).closest(".project-row")!;
    fireEvent.contextMenu(row);

    expect(screen.getByRole("menuitem", { name: "Open in VS Code" })).toBeDisabled();
  });

  it("surfaces a folder action failure in the error banner", async () => {
    const harness = createApi();
    vi.mocked(harness.api.projects.openOnGitHub).mockRejectedValue(new Error("This folder has no git remote named origin"));
    window.multiCliWork = harness.api;
    render(<App />);

    const row = (await screen.findByRole("button", { name: "Select folder Atlas" })).closest(".project-row")!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open on GitHub" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This folder has no git remote named origin");
  });

  it("confirms before removing a folder that still has sessions, and leaves the disk alone", async () => {
    const harness = createApi({ projects: [atlas, dashboard] });
    window.multiCliWork = harness.api;
    render(<App />);

    const row = (await screen.findByRole("button", { name: "Select folder Atlas" })).closest(".project-row")!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from list" }));

    const dialog = screen.getByRole("dialog", { name: "Remove folder from list" });
    expect(dialog).toHaveTextContent("2 sessions in this folder will be stopped");
    expect(harness.api.projects.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(harness.api.projects.remove).toHaveBeenCalledWith(atlas.id));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Select folder Atlas" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Open PowerShell session" })).not.toBeInTheDocument();
  });

  it("removes a folder without a prompt when it has no sessions", async () => {
    const harness = createApi({ projects: [atlas, dashboard], sessions: [] });
    window.multiCliWork = harness.api;
    render(<App />);

    const row = (await screen.findByRole("button", { name: "Select folder Dashboard" })).closest(".project-row")!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove from list" }));

    expect(screen.queryByRole("dialog", { name: "Remove folder from list" })).not.toBeInTheDocument();
    await waitFor(() => expect(harness.api.projects.remove).toHaveBeenCalledWith(dashboard.id));
  });

  it("keeps the launchers exposed whether or not the folder already has sessions", async () => {
    const empty = createApi({ sessions: [] });
    window.multiCliWork = empty.api;
    const view = render(<App />);

    await screen.findByRole("button", { name: "Select folder Atlas" });
    expect(screen.getByRole("button", { name: "New PowerShell session" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "New Codex session" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "New session" })).not.toBeInTheDocument();

    view.unmount();
    const busy = createApi();
    window.multiCliWork = busy.api;
    render(<App />);

    await screen.findByRole("button", { name: "Select folder Atlas" });
    expect(screen.queryByRole("button", { name: "New session" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New Claude Code session" }));

    await waitFor(() =>
      expect(busy.api.terminals.create).toHaveBeenCalledWith({
        projectId: atlas.id,
        kind: "claude",
        cols: 80,
        rows: 24,
      }),
    );
  });

  it("persists selection and creates only available provider sessions", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Select folder Atlas" }));
    fireEvent.click(screen.getByRole("button", { name: "New PowerShell session" }));

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

  it("keeps sessions in creation order when one is opened or changes status", async () => {
    const second: TerminalSessionView = {
      ...powershellSession,
      id: "session-pwsh-second",
      createdAt: "2026-07-11T03:00:00.000Z",
      updatedAt: "2026-07-11T03:00:00.000Z",
    };
    const harness = createApi({ sessions: [powershellSession, second] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Select folder Atlas" });
    const order = () =>
      [...document.querySelectorAll(".session-row")].map((row) => row.getAttribute("aria-label"));
    expect(order()).toEqual(["Open PowerShell 1 session", "Open PowerShell 2 session"]);

    // Opening the newer session bumps its updatedAt; the tree must not reshuffle.
    fireEvent.click(screen.getByRole("button", { name: "Open PowerShell 2 session" }));
    await act(async () => {
      harness.emit({ type: "status", sessionId: second.id, status: "working" });
    });

    expect(order()).toEqual(["Open PowerShell 1 session", "Open PowerShell 2 session"]);
  });

  it("updates a CLI in a maintenance session that belongs to no folder", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Select folder Atlas" });
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Update Claude Code" }));

    await waitFor(() =>
      expect(harness.api.terminals.createTool).toHaveBeenCalledWith({ tool: "claude-update", cols: 80, rows: 24 }),
    );
    expect(harness.api.terminals.select).toHaveBeenCalledWith(null, toolSession.id);
    expect(await screen.findByRole("button", { name: "Open Claude Code update session" })).toBeInTheDocument();
    expect(document.querySelector(".workspace-title")).toHaveTextContent("Tools");
  });

  it("restores a maintenance session without silently selecting the first folder", async () => {
    const harness = createApi({
      sessions: [powershellSession, toolSession],
      selection: { selectedProjectId: null, selectedSessionId: toolSession.id },
    });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Select folder Atlas" });
    expect(document.querySelector(".project-row.selected")).toBeNull();
    expect(document.querySelector(".session-row.selected")).toHaveAttribute(
      "aria-label",
      "Open Claude Code update session",
    );
    expect(document.querySelector(".workspace-title")).toHaveTextContent("Tools");
  });

  it("keeps the Tools menu usable when no folder is open, but not for a missing CLI", async () => {
    const harness = createApi({ projects: [], sessions: [] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByText("No folders yet");
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));

    // Codex is absent in this harness, so its update must not be offered.
    expect(screen.getByRole("menuitem", { name: "Update Codex" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Update Claude Code" }));

    await waitFor(() =>
      expect(harness.api.terminals.createTool).toHaveBeenCalledWith({ tool: "claude-update", cols: 80, rows: 24 }),
    );
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

  it("keeps the mounted terminal and final live output when a session exits", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "powershell terminal" });
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalledOnce());
    const terminal = terminalHarness.instances.at(-1)!;

    await act(async () => {
      harness.emit({
        type: "data",
        sessionId: powershellSession.id,
        data: "final output\r\n",
        sequence: 1,
      });
      harness.emit({ type: "exit", sessionId: powershellSession.id, exitCode: 0 });
    });

    expect(terminal.write).toHaveBeenCalledWith("final output\r\n");
    expect(terminalHarness.instances).toHaveLength(1);
    expect(harness.api.terminals.attach).toHaveBeenCalledOnce();
  });

  it("keeps backup registry data visible and read-only", async () => {
    const harness = createApi({
      source: "backup",
      writable: false,
      warning: "Registry backup is in use.",
    });
    window.multiCliWork = harness.api;

    render(<App />);

    expect(await screen.findByRole("button", { name: "Select folder Atlas" })).toBeInTheDocument();
    expect(screen.getByText(/Registry backup is in use/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open folder" })).toBeDisabled();
    expect(screen.queryByText("Workspace could not be loaded")).not.toBeInTheDocument();
  });

  it("marks missing folder roots, offers relink, and disables new sessions until relinked", async () => {
    const harness = createApi({ missingRootProjectIds: [atlas.id] });
    vi.mocked(harness.api.projects.relink).mockResolvedValue({ ...atlas, rootPath: "D:\\restored\\atlas" });
    window.multiCliWork = harness.api;
    render(<App />);

    expect(await screen.findByText("Folder is missing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New PowerShell session" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Relink folder" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Relink folder" }));
    await waitFor(() => expect(harness.api.projects.relink).toHaveBeenCalledWith(atlas.id));
    expect(screen.queryByText("Folder is missing")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New PowerShell session" })).toBeEnabled();
  });

  it("clamps a draggable sidebar between stable minimum and viewport-aware maximum widths", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("button", { name: "Select folder Atlas" });
    const separator = screen.getByRole("separator", { name: "Resize folder sidebar" });
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

    expect(await screen.findByText("No folders yet")).toBeInTheDocument();
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
    expect(await screen.findByRole("button", { name: "Select folder Atlas" })).toBeInTheDocument();
  });
});
