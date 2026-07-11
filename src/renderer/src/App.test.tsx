import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MultiCliWorkApi, TerminalSessionView } from "@shared/api-types";
import type { ProjectRegistrySnapshot, SharedProject } from "@shared/project-types";
import type { TerminalWorkerEvent } from "@shared/terminal-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const terminalHarness = vi.hoisted(() => ({
  instances: [] as Array<{
    cols: number;
    rows: number;
    write: ReturnType<typeof vi.fn>;
    emitInput(data: string): void;
  }>,
  fit: vi.fn(),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class TerminalMock {
    cols = 96;
    rows = 28;
    write = vi.fn();
    private readonly inputListeners = new Set<(data: string) => void>();

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

    emitInput(data: string) {
      for (const listener of this.inputListeners) listener(data);
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

function registry(projects: SharedProject[] = [atlas]): ProjectRegistrySnapshot {
  return {
    source: "primary",
    writable: true,
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
}) {
  const listeners = new Set<(event: TerminalWorkerEvent) => void>();
  const projects = options?.projects ?? [atlas];
  const sessions = options?.sessions ?? [powershellSession, claudeSession];
  const snapshot = { ...registry(projects), warning: options?.warning };
  const created: TerminalSessionView = {
    ...powershellSession,
    id: "session-new",
    status: "starting",
    pid: 4200,
    createdAt: "2026-07-11T04:00:00.000Z",
    updatedAt: "2026-07-11T04:00:00.000Z",
  };
  let resumedSession: TerminalSessionView | null = null;

  const api: MultiCliWorkApi = {
    platform: "win32",
    projects: {
      list: vi.fn().mockResolvedValue(snapshot),
      refresh: vi.fn().mockResolvedValue(snapshot),
      addFolder: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      relink: vi.fn().mockResolvedValue(null),
    },
    providers: {
      availability: vi.fn().mockResolvedValue({ powershell: true, claude: true, codex: false }),
    },
    terminals: {
      list: vi.fn().mockResolvedValue(sessions),
      create: vi.fn().mockResolvedValue(created),
      attach: vi.fn().mockImplementation(async (sessionId: string) => ({
        session: sessionId === claudeSession.id ? resumedSession ?? claudeSession : sessionId === created.id ? created : powershellSession,
        replay: `${sessionId} replay\r\n`,
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
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserverMock {
      constructor(private readonly listener: ResizeObserverCallback) {}
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
    expect(harness.api.providers.availability).toHaveBeenCalledOnce();
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
      harness.emit({ type: "data", sessionId: powershellSession.id, data: "C:\\work\\atlas\r\n" });
    });
    expect(terminal.write).toHaveBeenCalledWith("C:\\work\\atlas\r\n");
    await waitFor(() => expect(harness.api.terminals.resize).toHaveBeenCalledWith(powershellSession.id, 96, 28));
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
