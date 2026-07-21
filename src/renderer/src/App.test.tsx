import type { AgentView } from "@shared/agent-types";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AppStateSnapshot } from "@shared/app-state-types";
import type { MultiCliWorkApi, ProjectWorkspaceSnapshot, TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { SharedWorktree } from "@shared/worktree-types";
import type { TerminalEvent } from "@shared/terminal-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

const terminalHarness = vi.hoisted(() => ({
  instances: [] as Array<{
    cols: number;
    rows: number;
    options: { cursorBlink?: boolean; cursorStyle?: string };
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
    readonly options: { cursorBlink?: boolean; cursorStyle?: string };
    private readonly inputListeners = new Set<(data: string) => void>();
    private keyHandler: ((event: KeyboardEvent) => boolean) | null = null;

    constructor(options: { cursorBlink?: boolean; cursorStyle?: string }) {
      this.options = options;
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
      const merged = { preventDefault: () => {}, ...event } as KeyboardEvent;
      return this.keyHandler?.(merged) ?? true;
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
  title: null,
  name: null,
  kind: "powershell",
  cwd: atlas.rootPath,
  providerConversationId: null,
  interruptedByShutdown: false,
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

const codexSession: TerminalSessionView = {
  ...powershellSession,
  id: "session-codex",
  kind: "codex",
  createdAt: "2026-07-11T04:00:00.000Z",
  updatedAt: "2026-07-11T04:00:00.000Z",
};

/** A session left behind by an agent the user has since removed from `agents.json`. */
const removedAgentSession: TerminalSessionView = {
  ...powershellSession,
  id: "session-gemini",
  kind: "gemini",
  title: null,
  name: null,
  status: "exited",
  pid: null,
  createdAt: "2026-07-11T03:00:00.000Z",
  updatedAt: "2026-07-11T03:00:00.000Z",
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

/** The three built-ins, with Codex missing from PATH. */
function agentFixture(id: string, label: string, available: boolean): AgentView {
  return {
    id,
    label,
    commands: [id],
    args: [],
    newSessionArgs: [],
    resumeArgs: [],
    conversationId: "none",
    statusAdapter: "signals",
    titleSource: "none",
    shiftEnter: "enter",
    icon: id,
    accentColor: null,
    builtin: true,
    available,
  };
}

const agentFixtures: AgentView[] = [
  agentFixture("powershell", "PowerShell", true),
  agentFixture("claude", "Claude Code", true),
  { ...agentFixture("codex", "Codex", false), shiftEnter: "alt-enter" },
];

function createApi(options?: {
  projects?: SharedProject[];
  sessions?: TerminalSessionView[];
  worktrees?: SharedWorktree[];
  warning?: string;
  source?: ProjectWorkspaceSnapshot["source"];
  writable?: boolean;
  missingRootProjectIds?: string[];
  selection?: Pick<AppStateSnapshot["state"], "selectedProjectId" | "selectedSessionId">;
}) {
  const listeners = new Set<(event: TerminalEvent) => void>();
  const attentionListeners = new Set<(unread: Record<string, "input" | "approval">) => void>();
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
      reorder: vi.fn().mockResolvedValue(registry(projects)),
      remove: vi.fn().mockImplementation(async (projectId: string) => registry(projects.filter((project) => project.id !== projectId))),
      relink: vi.fn().mockResolvedValue(null),
      restoreBackup: vi.fn().mockResolvedValue(registry(projects)),
      reveal: vi.fn().mockResolvedValue(undefined),
      openInEditor: vi.fn().mockResolvedValue(undefined),
      openOnGitHub: vi.fn().mockResolvedValue(undefined),
      gitStatus: vi.fn().mockResolvedValue({ isRepo: true, branch: "main", changedFileCount: 0 }),
      gitDiff: vi.fn().mockResolvedValue({ isRepo: true, diff: "", untracked: [], truncated: false }),
    },
    worktrees: {
      list: vi.fn().mockResolvedValue(options?.worktrees ?? []),
      create: vi.fn(),
      remove: vi.fn().mockResolvedValue({ removed: true }),
      reveal: vi.fn().mockResolvedValue(undefined),
      openInEditor: vi.fn().mockResolvedValue(undefined),
      gitStatus: vi.fn().mockResolvedValue({ isRepo: true, branch: "feature", changedFileCount: 0 }),
      gitDiff: vi.fn().mockResolvedValue({ isRepo: true, diff: "", untracked: [], truncated: false }),
    },
    providers: {
      availability: vi.fn().mockResolvedValue({ vscode: true }),
    },
    agents: {
      list: vi.fn().mockResolvedValue({ agents: agentFixtures }),
      edit: vi.fn().mockResolvedValue(undefined),
    },
    files: {
      pathFor: vi.fn((file: File) => `C:\\dropped\\${file.name}`),
    },
    workspaceFiles: {
      listDirectory: vi.fn().mockResolvedValue([]),
      readFile: vi.fn().mockResolvedValue({ relativePath: "", encoding: "utf8", content: "", truncated: false, sizeBytes: 0 }),
      writeFile: vi.fn().mockResolvedValue(undefined),
      runExecutable: vi.fn().mockResolvedValue(undefined),
    },
    git: {
      panelData: vi.fn().mockResolvedValue({
        isRepo: true,
        currentBranch: "main",
        upstream: null,
        ahead: null,
        behind: null,
        branches: ["main"],
        changes: [],
      }),
      checkout: vi.fn().mockResolvedValue(undefined),
      createBranch: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue(undefined),
      push: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn().mockResolvedValue(undefined),
      pull: vi.fn().mockResolvedValue(undefined),
      fileOriginal: vi.fn().mockResolvedValue({ content: "", truncated: false }),
    },
    gitGraph: {
      list: vi.fn().mockResolvedValue({ commits: [], offset: 0, limit: 200, hasMore: false }),
      commitDetails: vi.fn().mockResolvedValue(null),
      fileDiff: vi.fn().mockResolvedValue(null),
      createBranch: vi.fn().mockResolvedValue(undefined),
      createTag: vi.fn().mockResolvedValue(undefined),
      cherryPick: vi.fn().mockResolvedValue(undefined),
      revert: vi.fn().mockResolvedValue(undefined),
    },
    htmlPreview: {
      open: vi.fn().mockResolvedValue(undefined),
      setBounds: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    },
    clipboard: {
      readText: vi.fn().mockResolvedValue("clipboard paste"),
      writeText: vi.fn().mockResolvedValue(undefined),
    },
    shell: {
      openExternal: vi.fn().mockResolvedValue(undefined),
    },
    attention: {
      state: vi.fn().mockResolvedValue({}),
      onEvent: vi.fn((listener) => {
        attentionListeners.add(listener);
        return () => attentionListeners.delete(listener);
      }),
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
      rename: vi.fn().mockImplementation(async (sessionId: string, name: string | null) => ({
        ...[...sessions, created, toolSession].find((session) => session.id === sessionId)!,
        name,
      })),
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
      split: vi.fn().mockResolvedValue(appState),
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
      openRepository: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn(() => () => undefined),
    },
  };

  return {
    api,
    created,
    emit(event: TerminalEvent) {
      for (const listener of listeners) listener(event);
    },
    emitAttention(unread: Record<string, "input" | "approval">) {
      for (const listener of attentionListeners) listener(unread);
    },
  };
}

beforeEach(() => {
  terminalHarness.instances.length = 0;
  terminalHarness.fit.mockReset();
  terminalHarness.resizeObservers.length = 0;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024, writable: true });
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

    expect(screen.getAllByText("작업 영역 불러오는 중")).toHaveLength(2);
    expect(await screen.findByRole("button", { name: "Atlas 폴더 선택" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PowerShell 세션 열기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claude Code 세션 열기" })).toBeInTheDocument();
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

    expect(await screen.findByRole("button", { name: "PowerShell 1 세션 열기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "PowerShell 2 세션 열기" })).toBeInTheDocument();
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

    const selectedProject = await screen.findByRole("button", { name: "Dashboard 폴더 선택" });
    expect(selectedProject.closest(".project-row")).toHaveClass("selected");
    expect(document.querySelector(".session-row.selected")).toHaveAttribute("aria-label", "PowerShell 세션 열기");
    expect(document.querySelector(".workspace-title")).toHaveTextContent("Dashboard");
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalledWith(dashboardSession.id));
  });

  it("renders a refresh button that reloads folders and sessions on click", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    expect(harness.api.projects.list).toHaveBeenCalledOnce();

    const refreshButton = screen.getByRole("button", { name: "폴더 새로고침" });
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

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    fireEvent.click(screen.getByRole("button", { name: "Atlas 접기" }));
    fireEvent.click(screen.getByRole("button", { name: "Dashboard 폴더 선택" }));
    fireEvent.click(await screen.findByRole("button", { name: "PowerShell 세션 열기" }));

    fireEvent.click(screen.getByRole("button", { name: "폴더 새로고침" }));
    await waitFor(() => expect(harness.api.projects.list).toHaveBeenCalledTimes(2));

    expect(screen.getByRole("button", { name: "Dashboard 폴더 선택" }).closest(".project-row")).toHaveClass(
      "selected",
    );
    expect(document.querySelector(".session-row.selected")).toHaveAttribute("aria-label", "PowerShell 세션 열기");
    expect(document.querySelector(".workspace-title")).toHaveTextContent("Dashboard");
  });

  it("falls back to another folder when the selected folder disappears during a manual refresh", async () => {
    const harness = createApi({ projects: [atlas, dashboard], sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    expect(screen.getByRole("button", { name: "Atlas 폴더 선택" }).closest(".project-row")).toHaveClass("selected");

    vi.mocked(harness.api.projects.list).mockResolvedValueOnce(registry([dashboard]));
    fireEvent.click(screen.getByRole("button", { name: "폴더 새로고침" }));

    await waitFor(() => expect(harness.api.projects.list).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Atlas 폴더 선택" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dashboard 폴더 선택" }).closest(".project-row")).toHaveClass(
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

    const restoreButton = await screen.findByRole("button", { name: "백업에서 레지스트리 복구" });
    fireEvent.click(restoreButton);

    await waitFor(() => expect(harness.api.projects.restoreBackup).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "백업에서 레지스트리 복구" })).not.toBeInTheDocument(),
    );
  });

  it("renames a folder from the context menu and updates the tree", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    vi.mocked(harness.api.projects.update).mockResolvedValue({ ...atlas, displayName: "Atlas Prime" });
    render(<App />);

    const row = await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    fireEvent.contextMenu(row.closest(".project-row")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "이름 변경" }));

    const editor = screen.getByRole("dialog", { name: "Atlas 이름 변경" });
    fireEvent.change(screen.getByLabelText("표시 이름"), { target: { value: "Atlas Prime" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(harness.api.projects.update).toHaveBeenCalledWith(atlas.id, { displayName: "Atlas Prime" }),
    );
    await screen.findByRole("button", { name: "Atlas Prime 폴더 선택" });
    expect(editor).not.toBeInTheDocument();
  });

  it("opens a folder in the file explorer, VS Code, and GitHub from the context menu", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    const row = (await screen.findByRole("button", { name: "Atlas 폴더 선택" })).closest(".project-row")!;

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "파일 탐색기에서 열기" }));
    await waitFor(() => expect(harness.api.projects.reveal).toHaveBeenCalledWith(atlas.id));

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "VS Code에서 열기" }));
    await waitFor(() => expect(harness.api.projects.openInEditor).toHaveBeenCalledWith(atlas.id));

    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "GitHub에서 열기" }));
    await waitFor(() => expect(harness.api.projects.openOnGitHub).toHaveBeenCalledWith(atlas.id));
  });

  it("disables the VS Code action when VS Code is not installed", async () => {
    const harness = createApi();
    vi.mocked(harness.api.providers.availability).mockResolvedValue({ vscode: false });
    window.multiCliWork = harness.api;
    render(<App />);

    const row = (await screen.findByRole("button", { name: "Atlas 폴더 선택" })).closest(".project-row")!;
    fireEvent.contextMenu(row);

    expect(screen.getByRole("menuitem", { name: "VS Code에서 열기" })).toBeDisabled();
  });

  it("surfaces a folder action failure in the error banner", async () => {
    const harness = createApi();
    vi.mocked(harness.api.projects.openOnGitHub).mockRejectedValue(new Error("This folder has no git remote named origin"));
    window.multiCliWork = harness.api;
    render(<App />);

    const row = (await screen.findByRole("button", { name: "Atlas 폴더 선택" })).closest(".project-row")!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "GitHub에서 열기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This folder has no git remote named origin");
  });

  it("confirms before removing a folder that still has sessions, and leaves the disk alone", async () => {
    const harness = createApi({ projects: [atlas, dashboard] });
    window.multiCliWork = harness.api;
    render(<App />);

    const row = (await screen.findByRole("button", { name: "Atlas 폴더 선택" })).closest(".project-row")!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "목록에서 제거" }));

    const dialog = screen.getByRole("dialog", { name: "목록에서 폴더 제거" });
    expect(dialog).toHaveTextContent("이 폴더의 세션 2개가 중지되고");
    expect(harness.api.projects.remove).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "제거" }));

    await waitFor(() => expect(harness.api.projects.remove).toHaveBeenCalledWith(atlas.id));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Atlas 폴더 선택" })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "PowerShell 세션 열기" })).not.toBeInTheDocument();
  });

  it("removes a folder without a prompt when it has no sessions", async () => {
    const harness = createApi({ projects: [atlas, dashboard], sessions: [] });
    window.multiCliWork = harness.api;
    render(<App />);

    const row = (await screen.findByRole("button", { name: "Dashboard 폴더 선택" })).closest(".project-row")!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "목록에서 제거" }));

    expect(screen.queryByRole("dialog", { name: "목록에서 폴더 제거" })).not.toBeInTheDocument();
    await waitFor(() => expect(harness.api.projects.remove).toHaveBeenCalledWith(dashboard.id));
  });

  it("keeps the launchers exposed whether or not the folder already has sessions", async () => {
    const empty = createApi({ sessions: [] });
    window.multiCliWork = empty.api;
    const view = render(<App />);

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    expect(screen.getByRole("button", { name: "새 PowerShell 세션" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "새 Codex 세션" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "새 세션" })).not.toBeInTheDocument();

    view.unmount();
    const busy = createApi();
    window.multiCliWork = busy.api;
    render(<App />);

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    expect(screen.queryByRole("button", { name: "새 세션" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "새 Claude Code 세션" }));

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

    fireEvent.click(await screen.findByRole("button", { name: "Atlas 폴더 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "새 PowerShell 세션" }));

    await waitFor(() =>
      expect(harness.api.terminals.create).toHaveBeenCalledWith({
        projectId: atlas.id,
        kind: "powershell",
        cols: 80,
        rows: 24,
      }),
    );
    expect(harness.api.terminals.select).toHaveBeenCalledWith(atlas.id, harness.created.id);
    expect((await screen.findAllByText("시작 중")).length).toBeGreaterThan(0);
  });

  it("lists a session announced by a created event even though this window never started it", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("button", { name: "PowerShell 세션 열기" });

    // Started outside the renderer — a jk-coding-cli spawn or a lazy auto-resume elsewhere.
    await act(async () => {
      harness.emit({
        type: "created",
        sessionId: "session-spawned",
        session: { ...powershellSession, id: "session-spawned", name: "스폰된 세션", status: "starting" },
      });
    });

    expect(await screen.findByRole("button", { name: "스폰된 세션 세션 열기" })).toBeInTheDocument();
  });

  it("names a session after the work it is doing, and carries its status as a row colour", async () => {
    const titled: TerminalSessionView = {
      ...claudeSession,
      id: "session-titled",
      title: "레지스트리 분리",
      status: "working",
      pid: 4400,
      exitCode: null,
    };
    const harness = createApi({ sessions: [powershellSession, titled] });
    window.multiCliWork = harness.api;
    render(<App />);

    const row = await screen.findByRole("button", { name: "레지스트리 분리 세션 열기" });
    expect(row).toHaveClass("status-working");
    expect(screen.getByRole("button", { name: "PowerShell 세션 열기" })).toHaveClass("status-idle");

    // A title that arrives mid-session renames the row without a reload.
    await act(async () => {
      harness.emit({ type: "title", sessionId: powershellSession.id, title: "빌드 로그 확인" });
    });

    expect(await screen.findByRole("button", { name: "빌드 로그 확인 세션 열기" })).toBeInTheDocument();
  });

  it("renames a session from its context menu and can hand the name back to the provider", async () => {
    const titled: TerminalSessionView = { ...claudeSession, id: "session-titled", title: "레지스트리 분리" };
    const harness = createApi({ sessions: [titled] });
    window.multiCliWork = harness.api;
    render(<App />);

    const row = await screen.findByRole("button", { name: "레지스트리 분리 세션 열기" });
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole("menuitem", { name: "이름 변경" }));

    const input = screen.getByLabelText("세션 이름");
    expect(input).toHaveValue("레지스트리 분리");
    fireEvent.change(input, { target: { value: "  내 작업  " } });
    fireEvent.submit(screen.getByRole("form", { name: "세션 이름 변경" }));

    await waitFor(() => expect(harness.api.terminals.rename).toHaveBeenCalledWith(titled.id, "내 작업"));
    const renamed = await screen.findByRole("button", { name: "내 작업 세션 열기" });

    fireEvent.contextMenu(renamed);
    fireEvent.click(screen.getByRole("menuitem", { name: "제공자 제목 사용" }));

    await waitFor(() => expect(harness.api.terminals.rename).toHaveBeenLastCalledWith(titled.id, null));
    expect(await screen.findByRole("button", { name: "레지스트리 분리 세션 열기" })).toBeInTheDocument();
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

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    const order = () =>
      [...document.querySelectorAll(".session-row")].map((row) => row.getAttribute("aria-label"));
    expect(order()).toEqual(["PowerShell 1 세션 열기", "PowerShell 2 세션 열기"]);

    // Opening the newer session bumps its updatedAt; the tree must not reshuffle.
    fireEvent.click(screen.getByRole("button", { name: "PowerShell 2 세션 열기" }));
    await act(async () => {
      harness.emit({ type: "status", sessionId: second.id, status: "working" });
    });

    expect(order()).toEqual(["PowerShell 1 세션 열기", "PowerShell 2 세션 열기"]);
  });

  it("updates a CLI in a maintenance session that belongs to no folder", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    fireEvent.click(screen.getByRole("button", { name: "도구" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Claude Code 업데이트" }));

    await waitFor(() =>
      expect(harness.api.terminals.createTool).toHaveBeenCalledWith({ tool: "claude-update", cols: 80, rows: 24 }),
    );
    expect(harness.api.terminals.select).toHaveBeenCalledWith(null, toolSession.id);
    expect(await screen.findByRole("button", { name: "Claude Code 업데이트 세션 열기" })).toBeInTheDocument();
    expect(document.querySelector(".workspace-title")).toHaveTextContent("도구");
  });

  it("restores a maintenance session without silently selecting the first folder", async () => {
    const harness = createApi({
      sessions: [powershellSession, toolSession],
      selection: { selectedProjectId: null, selectedSessionId: toolSession.id },
    });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    expect(document.querySelector(".project-row.selected")).toBeNull();
    expect(document.querySelector(".session-row.selected")).toHaveAttribute(
      "aria-label",
      "Claude Code 업데이트 세션 열기",
    );
    expect(document.querySelector(".workspace-title")).toHaveTextContent("도구");
  });

  it("keeps the Tools menu usable when no folder is open, but not for a missing CLI", async () => {
    const harness = createApi({ projects: [], sessions: [] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByText("아직 폴더가 없습니다");
    fireEvent.click(screen.getByRole("button", { name: "도구" }));

    // Codex is absent in this harness, so its update must not be offered.
    expect(screen.getByRole("menuitem", { name: "Codex 업데이트" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Claude Code 업데이트" }));

    await waitFor(() =>
      expect(harness.api.terminals.createTool).toHaveBeenCalledWith({ tool: "claude-update", cols: 80, rows: 24 }),
    );
  });

  it("manually resumes, stops, and removes a finished session", async () => {
    const harness = createApi({ sessions: [claudeSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Claude Code 세션 열기" }));
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalledWith(claudeSession.id));
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    expect(harness.api.terminals.resize).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "세션 재개" }));
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

    fireEvent.click(await screen.findByRole("button", { name: "세션 중지" }));
    expect(harness.api.terminals.stop).toHaveBeenCalledWith(claudeSession.id);

    await act(async () => {
      harness.emit({ type: "exit", sessionId: claudeSession.id, exitCode: 0 });
    });
    fireEvent.click(screen.getByRole("button", { name: "세션 제거" }));
    await waitFor(() => expect(harness.api.terminals.remove).toHaveBeenCalledWith(claudeSession.id));
    expect(harness.api.terminals.select).toHaveBeenLastCalledWith(atlas.id, null);
    expect(screen.getByText("Atlas에서 세션 시작")).toBeInTheDocument();
  });

  it("keeps the terminal in a dedicated flexible workspace body", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    const terminalRegion = await screen.findByRole("region", { name: "powershell 터미널" });
    expect(terminalRegion.parentElement).toHaveClass("workspace-body");
  });

  it("attaches replay, forwards input and live output, and resizes the PTY", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "PowerShell 세션 열기" }));
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalledWith(powershellSession.id));
    const terminal = terminalHarness.instances.at(-1)!;
    expect(terminal.options).toMatchObject({ cursorBlink: false, cursorStyle: "bar" });
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

    await screen.findByRole("region", { name: "powershell 터미널" });
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

  it("maps both copy and paste shortcuts to the native clipboard without duplicate terminal input", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "powershell 터미널" });
    const terminal = terminalHarness.instances.at(-1)!;
    terminal.selection = "selected output";

    const copyPreventDefault = vi.fn();
    expect(
      terminal.emitKey({
        type: "keydown",
        ctrlKey: true,
        code: "KeyC",
        preventDefault: copyPreventDefault,
      }),
    ).toBe(false);
    expect(copyPreventDefault).toHaveBeenCalledOnce();
    await waitFor(() => expect(harness.api.clipboard.writeText).toHaveBeenCalledWith("selected output"));

    terminal.selection = "shift selected output";
    expect(terminal.emitKey({ type: "keydown", ctrlKey: true, shiftKey: true, code: "KeyC" })).toBe(false);
    await waitFor(() => expect(harness.api.clipboard.writeText).toHaveBeenCalledWith("shift selected output"));

    vi.mocked(harness.api.terminals.write).mockClear();
    const pastePreventDefault = vi.fn();
    expect(
      terminal.emitKey({
        type: "keydown",
        ctrlKey: true,
        code: "KeyV",
        preventDefault: pastePreventDefault,
      }),
    ).toBe(false);
    expect(pastePreventDefault).toHaveBeenCalledOnce();
    await waitFor(() => expect(terminal.paste).toHaveBeenCalledWith("clipboard paste"));
    expect(harness.api.terminals.write).not.toHaveBeenCalled();

    expect(terminal.emitKey({ type: "keydown", ctrlKey: true, shiftKey: true, code: "KeyV" })).toBe(false);
    await waitFor(() => expect(terminal.paste).toHaveBeenCalledTimes(2));
    // With nothing selected, a plain Ctrl+C stays the terminal interrupt rather than a copy.
    terminal.selection = "";
    expect(terminal.emitKey({ type: "keydown", ctrlKey: true, code: "KeyC" })).toBe(true);
  });

  it("consumes Ctrl+Shift+C without a selection but leaves Ctrl+C available for terminal interrupt", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "powershell 터미널" });
    const terminal = terminalHarness.instances.at(-1)!;

    expect(terminal.emitKey({ type: "keydown", ctrlKey: true, shiftKey: true, code: "KeyC" })).toBe(false);
    expect(harness.api.clipboard.writeText).not.toHaveBeenCalled();
    expect(terminal.emitKey({ type: "keydown", ctrlKey: true, code: "KeyC" })).toBe(true);
  });

  it("does not paste into a read-only terminal", async () => {
    const harness = createApi({ sessions: [{ ...powershellSession, status: "exited", pid: null, exitCode: 0 }] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "powershell 터미널" });
    const terminal = terminalHarness.instances.at(-1)!;
    expect(terminal.emitKey({ type: "keydown", ctrlKey: true, code: "KeyV" })).toBe(false);
    await Promise.resolve();
    expect(harness.api.clipboard.readText).not.toHaveBeenCalled();
    expect(terminal.paste).not.toHaveBeenCalled();
  });

  it("does not resize after a running session transitions to exited", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("region", { name: "powershell 터미널" });
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

    await screen.findByRole("region", { name: "powershell 터미널" });
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

    expect(await screen.findByRole("button", { name: "Atlas 폴더 선택" })).toBeInTheDocument();
    expect(screen.getByText(/Registry backup is in use/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "폴더 열기" })).toBeDisabled();
    expect(screen.queryByText("작업 영역을 불러오지 못했습니다")).not.toBeInTheDocument();
  });

  it("marks missing folder roots, offers relink, and disables new sessions until relinked", async () => {
    const harness = createApi({ missingRootProjectIds: [atlas.id] });
    vi.mocked(harness.api.projects.relink).mockResolvedValue({ ...atlas, rootPath: "D:\\restored\\atlas" });
    window.multiCliWork = harness.api;
    render(<App />);

    expect(await screen.findByText("폴더를 찾을 수 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "새 PowerShell 세션" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "폴더 다시 연결" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "폴더 다시 연결" }));
    await waitFor(() => expect(harness.api.projects.relink).toHaveBeenCalledWith(atlas.id));
    expect(screen.queryByText("폴더를 찾을 수 없습니다")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "새 PowerShell 세션" })).toBeEnabled();
  });

  it("clamps a draggable sidebar between stable minimum and viewport-aware maximum widths", async () => {
    // The right-hand file explorer also reserves its default width against the same viewport, so
    // this needs headroom beyond the old single-sidebar 900px to still land on a mid-range max
    // (900 - 480 workspace - 4 resizer - 280 file explorer - 4 resizer would floor straight to 200).
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1184 });
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    const separator = screen.getByRole("separator", { name: "폴더 사이드바 크기 조절" });
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

    expect(await screen.findByText("아직 폴더가 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Registry backup is in use.");

    view.unmount();
    const retryHarness = createApi();
    vi.mocked(retryHarness.api.projects.list)
      .mockRejectedValueOnce(new Error("Registry unavailable"))
      .mockResolvedValueOnce(registry());
    window.multiCliWork = retryHarness.api;
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Registry unavailable");
    fireEvent.click(screen.getByRole("button", { name: "재시도" }));
    expect(await screen.findByRole("button", { name: "Atlas 폴더 선택" })).toBeInTheDocument();
  });

  it("opens the home dashboard from the logo without disturbing the current selection", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    fireEvent.click(screen.getByRole("button", { name: "홈 대시보드 열기" }));

    expect(screen.getByRole("region", { name: "홈 대시보드" })).toBeInTheDocument();
    expect(document.querySelector(".project-row.selected")).toBeNull();
    expect(document.querySelector(".session-row.selected")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Atlas 폴더 선택" }));
    expect(screen.queryByRole("region", { name: "홈 대시보드" })).not.toBeInTheDocument();
  });

  it("shows the project detail page when a folder is clicked instead of a session", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    // Boots straight into the terminal (the only session gets auto-selected); clicking the
    // folder itself must still switch away from it to the detail page.
    await screen.findByRole("region", { name: "powershell 터미널" });
    fireEvent.click(screen.getByRole("button", { name: "Atlas 폴더 선택" }));

    expect(screen.getByRole("region", { name: "프로젝트 상세" })).toBeInTheDocument();
    expect(document.querySelector(".session-row.selected")).toBeNull();
  });

  it("restores straight to the project detail page when a folder but no session was persisted", async () => {
    // No sessions exist at all, so the "selectedSessionId" fallback in the test harness (which
    // otherwise defaults to the first session) also resolves to null here — the folder itself is
    // still the persisted selection.
    const harness = createApi({
      sessions: [],
      selection: { selectedProjectId: atlas.id, selectedSessionId: null },
    });
    window.multiCliWork = harness.api;
    render(<App />);

    expect(await screen.findByRole("region", { name: "프로젝트 상세" })).toBeInTheDocument();
    expect(screen.getByText("Atlas에서 세션 시작")).toBeInTheDocument();
  });

  /**
   * The session rows used to index a fixed provider table by kind, so a session whose agent was no
   * longer listed took the whole sidebar down. It now falls back to the agent's id.
   */
  it("still lists a session whose agent was removed from agents.json", async () => {
    const harness = createApi({
      sessions: [removedAgentSession],
      selection: { selectedProjectId: atlas.id, selectedSessionId: null },
    });
    window.multiCliWork = harness.api;
    render(<App />);

    expect(await screen.findByRole("button", { name: "gemini 세션 열기" })).toBeInTheDocument();
  });
});

describe("quick open palette", () => {
  it("opens on Ctrl+P, jumps to the matched session, and closes on Escape", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("button", { name: "Atlas 폴더 선택" });

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const input = await screen.findByRole("textbox", { name: "빠른 열기 검색" });
    fireEvent.change(input, { target: { value: "claude" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.queryByRole("dialog", { name: "빠른 열기" })).not.toBeInTheDocument();
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalledWith(claudeSession.id));

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "빠른 열기 검색" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "빠른 열기" })).not.toBeInTheDocument();
  });

  it("lists folders and commands alongside sessions", async () => {
    const harness = createApi({ projects: [atlas, dashboard] });
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("button", { name: "Atlas 폴더 선택" });

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const dialog = await screen.findByRole("dialog", { name: "빠른 열기" });
    const input = within(dialog).getByRole("textbox", { name: "빠른 열기 검색" });

    fireEvent.change(input, { target: { value: "dash" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("region", { name: "프로젝트 상세" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "p", ctrlKey: true });
    const reopened = await screen.findByRole("dialog", { name: "빠른 열기" });
    fireEvent.change(within(reopened).getByRole("textbox", { name: "빠른 열기 검색" }), {
      target: { value: "홈 대시보드" },
    });
    fireEvent.keyDown(within(reopened).getByRole("textbox", { name: "빠른 열기 검색" }), { key: "Enter" });
    expect(screen.getByRole("region", { name: "홈 대시보드" })).toBeInTheDocument();
  });
});

describe("unread badges", () => {
  it("marks the session and its folder while an off-screen session waits, and clears afterwards", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("button", { name: "Atlas 폴더 선택" });

    act(() => harness.emitAttention({ [claudeSession.id]: "approval" }));

    expect(screen.getByRole("button", { name: "Claude Code 세션 열기 (읽지 않음)" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "응답 대기 세션 있음" })).toBeInTheDocument();

    act(() => harness.emitAttention({}));

    expect(screen.getByRole("button", { name: "Claude Code 세션 열기" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "응답 대기 세션 있음" })).not.toBeInTheDocument();
  });
});

const atlasWorktree: SharedWorktree = {
  id: "worktree-1",
  projectId: atlas.id,
  path: "C:\\work\\atlas-wt\\feature-x",
  branch: "feature-x",
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
};

describe("worktrees", () => {
  const worktreeSession: TerminalSessionView = {
    ...powershellSession,
    id: "session-wt",
    name: "WT 세션",
    worktreeId: atlasWorktree.id,
    cwd: atlasWorktree.path,
  };

  it("nests worktree sessions under a third tree level and scopes the detail page to it", async () => {
    const harness = createApi({
      sessions: [powershellSession, worktreeSession],
      worktrees: [atlasWorktree],
      selection: { selectedProjectId: atlas.id, selectedSessionId: null },
    });
    window.multiCliWork = harness.api;
    render(<App />);

    const worktreeButton = await screen.findByRole("button", { name: "feature-x worktree 선택" });
    fireEvent.click(worktreeButton);

    const detail = await screen.findByRole("region", { name: "프로젝트 상세" });
    expect(within(detail).getByRole("button", { name: "WT 세션 세션 보기" })).toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: /PowerShell.*세션 보기/ })).not.toBeInTheDocument();

    // A session started while the worktree is selected runs in the worktree, not the root.
    fireEvent.click(screen.getByRole("button", { name: "새 PowerShell 세션" }));
    await waitFor(() =>
      expect(harness.api.terminals.create).toHaveBeenCalledWith(
        expect.objectContaining({ worktreeId: atlasWorktree.id }),
      ),
    );
  });

  it("blocks removal behind a dirty check and requires the explicit force confirmation", async () => {
    const harness = createApi({
      sessions: [worktreeSession],
      worktrees: [atlasWorktree],
      selection: { selectedProjectId: atlas.id, selectedSessionId: null },
    });
    window.multiCliWork = harness.api;
    vi.mocked(harness.api.worktrees.remove).mockResolvedValueOnce({
      removed: false,
      reason: "dirty",
      message: "feature-x에 커밋되지 않은 변경 2개가 있습니다.",
    });
    render(<App />);

    fireEvent.contextMenu(await screen.findByRole("button", { name: "feature-x worktree 선택" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Worktree 제거" }));

    // First: the session-teardown confirmation.
    const confirm = await screen.findByRole("dialog", { name: "Worktree 제거" });
    expect(confirm).toHaveTextContent("세션 1개");
    fireEvent.click(within(confirm).getByRole("button", { name: "제거" }));

    // git refused: the force dialog quotes the reason, and only its explicit button forces.
    const force = await screen.findByRole("dialog", { name: "Worktree 강제 제거" });
    expect(force).toHaveTextContent("커밋되지 않은 변경 2개");
    expect(harness.api.worktrees.remove).toHaveBeenCalledWith(atlasWorktree.id, false);

    fireEvent.click(within(force).getByRole("button", { name: "변경을 버리고 강제 제거" }));
    await waitFor(() => expect(harness.api.worktrees.remove).toHaveBeenCalledWith(atlasWorktree.id, true));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "feature-x worktree 선택" })).not.toBeInTheDocument(),
    );
  });
});

describe("prompt fan-out", () => {
  it("sends the prompt to every checked alive session and skips exited ones", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Atlas 폴더 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "프롬프트 팬아웃" }));

    const dialog = await screen.findByRole("dialog", { name: "프롬프트 팬아웃" });
    // claudeSession is exited, so only the PowerShell session is offered.
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "팬아웃 프롬프트" }), {
      target: { value: "상태를 보고해줘" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "1개 세션에 전송" }));

    await waitFor(() =>
      expect(harness.api.terminals.write).toHaveBeenCalledWith(powershellSession.id, "상태를 보고해줘\r"),
    );
  });
});

describe("workspace split", () => {
  it("shows two terminals, marks the split persistent, and collapses on close", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    // Boots into the PowerShell terminal; split it with the exited Claude session.
    await screen.findByRole("region", { name: "powershell 터미널" });
    fireEvent.click(screen.getByRole("button", { name: "화면 분할" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Claude Code" }));

    expect(await screen.findByRole("region", { name: "claude 터미널" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "powershell 터미널" })).toBeInTheDocument();
    expect(harness.api.terminals.split).toHaveBeenCalledWith(claudeSession.id);
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalledWith(claudeSession.id));

    fireEvent.click(screen.getByRole("button", { name: "분할 닫기" }));
    expect(screen.queryByRole("region", { name: "claude 터미널" })).not.toBeInTheDocument();
    expect(harness.api.terminals.split).toHaveBeenLastCalledWith(null);
  });

  it("collapses the split when its session is promoted to the primary pane", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "powershell 터미널" });
    fireEvent.click(screen.getByRole("button", { name: "화면 분할" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Claude Code" }));
    await screen.findByRole("region", { name: "claude 터미널" });

    fireEvent.click(screen.getByRole("button", { name: "Claude Code 세션 열기" }));

    expect(harness.api.terminals.split).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("region", { name: "claude 터미널" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "powershell 터미널" })).not.toBeInTheDocument();
  });
});

describe("diff view", () => {
  it("opens the read-only diff for the selected project", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    vi.mocked(harness.api.projects.gitDiff).mockResolvedValue({
      isRepo: true,
      diff: "diff --git a/app.ts b/app.ts\n+added line",
      untracked: ["notes.md"],
      truncated: false,
    });
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Atlas 폴더 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "변경 보기" }));

    const dialog = await screen.findByRole("dialog", { name: "변경 보기" });
    expect(within(dialog).getByText("app.ts")).toBeInTheDocument();
    expect(within(dialog).getByText("+added line")).toBeInTheDocument();
    expect(within(dialog).getByText("notes.md")).toBeInTheDocument();
  });
});

describe("file drop", () => {
  it("pastes dropped file paths into the terminal as quoted prompt text", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "powershell 터미널" });
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalled());

    const host = document.querySelector(".terminal-host")!;
    fireEvent.drop(host, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["x"], "shot.png"), new File(["y"], "notes.md")],
      },
    });

    const terminal = terminalHarness.instances.at(-1)!;
    expect(terminal.paste).toHaveBeenCalledWith('"C:\\dropped\\shot.png" "C:\\dropped\\notes.md" ');
  });

  it("ignores drops on an exited session", async () => {
    const harness = createApi({
      sessions: [claudeSession],
      selection: { selectedProjectId: atlas.id, selectedSessionId: claudeSession.id },
    });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "claude 터미널" });
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalled());

    const host = document.querySelector(".terminal-host")!;
    fireEvent.drop(host, {
      dataTransfer: { types: ["Files"], files: [new File(["x"], "shot.png")] },
    });

    const terminal = terminalHarness.instances.at(-1)!;
    expect(terminal.paste).not.toHaveBeenCalled();
  });
});

describe("Shift+Enter", () => {
  const ESC_CR = `${String.fromCharCode(0x1b)}\r`;

  it("sends Alt+Enter to an agent that asks for it, so Codex inserts a newline instead of submitting", async () => {
    const harness = createApi({
      sessions: [codexSession],
      selection: { selectedProjectId: atlas.id, selectedSessionId: codexSession.id },
    });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "codex 터미널" });
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalled());

    const terminal = terminalHarness.instances.at(-1)!;
    // False keeps xterm from also sending its own CR, which would submit the prompt anyway.
    expect(terminal.emitKey({ type: "keydown", key: "Enter", shiftKey: true })).toBe(false);

    await waitFor(() => expect(harness.api.terminals.write).toHaveBeenCalledWith(codexSession.id, ESC_CR));
  });

  it("leaves Shift+Enter alone for an agent with no substitute, so it still submits", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "powershell 터미널" });
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalled());

    const terminal = terminalHarness.instances.at(-1)!;
    expect(terminal.emitKey({ type: "keydown", key: "Enter", shiftKey: true })).toBe(true);
    expect(harness.api.terminals.write).not.toHaveBeenCalledWith(powershellSession.id, ESC_CR);
  });

  it("writes once per press, not again on keyup", async () => {
    const harness = createApi({
      sessions: [codexSession],
      selection: { selectedProjectId: atlas.id, selectedSessionId: codexSession.id },
    });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "codex 터미널" });
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalled());

    const terminal = terminalHarness.instances.at(-1)!;
    terminal.emitKey({ type: "keydown", key: "Enter", shiftKey: true });
    expect(terminal.emitKey({ type: "keyup", key: "Enter", shiftKey: true })).toBe(false);

    await waitFor(() =>
      expect(
        (harness.api.terminals.write as ReturnType<typeof vi.fn>).mock.calls.filter(
          ([, data]) => data === ESC_CR,
        ),
      ).toHaveLength(1),
    );
  });
});
