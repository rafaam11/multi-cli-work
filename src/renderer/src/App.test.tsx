import type { AgentView } from "@shared/agent-types";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AppStateSnapshot } from "@shared/app-state-types";
import type { MultiCliWorkApi, ProjectWorkspaceSnapshot, TerminalSessionView, WindowChromeState } from "@shared/api-types";
import type { FileTreeEntry } from "@shared/file-explorer-types";
import type { SharedProject } from "@shared/project-types";
import type { WorkProject, WorkProjectRegistryV1 } from "@shared/work-project-types";
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
    selectAll: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
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
    selectAll = vi.fn();
    clear = vi.fn();
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
    dispose = vi.fn();

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
  workProjects?: WorkProject[];
  selection?: Pick<AppStateSnapshot["state"], "selectedProjectId" | "selectedSessionId">;
}) {
  const listeners = new Set<(event: TerminalEvent) => void>();
  const attentionListeners = new Set<(unread: Record<string, "input" | "approval">) => void>();
  const navigationListeners = new Set<(sessionId: string) => void>();
  const windowStateListeners = new Set<(state: WindowChromeState) => void>();
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

  const workProjectRegistry: WorkProjectRegistryV1 = {
    schemaVersion: 1,
    updatedAt: "2026-07-11T04:00:00.000Z",
    teamsSyncRoot: null,
    workProjects: Object.fromEntries(
      (options?.workProjects ?? []).map((workProject) => [workProject.id, workProject]),
    ),
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
    workProjects: {
      list: vi.fn().mockResolvedValue(workProjectRegistry),
      create: vi.fn().mockResolvedValue(workProjectRegistry),
      update: vi.fn().mockResolvedValue(workProjectRegistry),
      remove: vi.fn().mockResolvedValue(workProjectRegistry),
      addMember: vi.fn().mockResolvedValue(workProjectRegistry),
      removeMember: vi.fn().mockResolvedValue(workProjectRegistry),
      reorder: vi.fn().mockResolvedValue(workProjectRegistry),
      addMemberFolder: vi.fn().mockResolvedValue(null),
      chooseLocalFolder: vi.fn().mockResolvedValue(null),
      revealLocalFolder: vi.fn().mockResolvedValue(undefined),
      chooseTeamsSyncRoot: vi.fn().mockResolvedValue(null),
      clearTeamsSyncRoot: vi.fn().mockResolvedValue(workProjectRegistry),
    },
    worktrees: {
      list: vi.fn().mockResolvedValue(options?.worktrees ?? []),
      sync: vi.fn().mockResolvedValue({
        workspaces: [
          ...projects.map((project) => ({ workspaceKey: `project:${project.id}:main`, kind: "main" as const, projectId: project.id, worktreeId: null, path: project.rootPath, branch: "main", head: "0123456789abcdef", changedFileCount: 0, availability: "available" as const, lockedReason: null, prunableReason: null })),
          ...(options?.worktrees ?? []).map((worktree) => ({ workspaceKey: `worktree:${worktree.id}`, kind: "worktree" as const, projectId: worktree.projectId, worktreeId: worktree.id, path: worktree.path, branch: worktree.branch, head: "0123456789abcdef", changedFileCount: 0, availability: "available" as const, lockedReason: null, prunableReason: null })),
        ],
        warnings: {},
      }),
      creationOptions: vi.fn().mockResolvedValue({ localBranches: [], remoteBranches: [], checkedOutBranches: [], defaultStartPoint: "main" }),
      previewPath: vi.fn().mockResolvedValue("C:\\Work-wt\\feature"),
      create: vi.fn(),
      unlock: vi.fn().mockResolvedValue(undefined),
      cleanupStale: vi.fn().mockResolvedValue({ workspaces: [], warnings: {} }),
      remove: vi.fn().mockResolvedValue({ removed: true }),
      reveal: vi.fn().mockResolvedValue(undefined),
      openInEditor: vi.fn().mockResolvedValue(undefined),
      gitStatus: vi.fn().mockResolvedValue({ isRepo: true, branch: "feature", changedFileCount: 0 }),
      gitDiff: vi.fn().mockResolvedValue({ isRepo: true, diff: "", untracked: [], truncated: false }),
    },
    github: {
      remotes: vi.fn().mockResolvedValue([]), status: vi.fn(), authenticate: vi.fn(), list: vi.fn(),
      detail: vi.fn(), diff: vi.fn(), comment: vi.fn(), reply: vi.fn(),
      activeReviews: vi.fn().mockResolvedValue([]), startReview: vi.fn(), refillReview: vi.fn(), finishReview: vi.fn(),
      annotations: vi.fn().mockResolvedValue({ annotations: [] }), upsertAnnotation: vi.fn(),
      deleteAnnotation: vi.fn(), sendDraftAnnotations: vi.fn(),
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
    navigation: {
      onSessionRequested: vi.fn((listener) => {
        navigationListeners.add(listener);
        return () => navigationListeners.delete(listener);
      }),
    },
    window: {
      minimize: vi.fn().mockResolvedValue(undefined),
      toggleMaximize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      state: vi.fn().mockResolvedValue({ maximized: false, fullScreen: false }),
      toggleFullScreen: vi.fn().mockResolvedValue(undefined),
      toggleDevTools: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockResolvedValue(undefined),
      zoom: vi.fn().mockResolvedValue(undefined),
      quit: vi.fn().mockResolvedValue(undefined),
      onStateChange: vi.fn((listener) => {
        windowStateListeners.add(listener);
        return () => windowStateListeners.delete(listener);
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
      refresh: vi.fn().mockImplementation(async (sessionId: string) => {
        const known = [...sessions, created, toolSession].find((session) => session.id === sessionId);
        return {
          session: known ?? powershellSession,
          replay: `${sessionId} refreshed\r\n`,
          sequence: 1,
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
      setVisibleSessions: vi.fn().mockResolvedValue(appState),
      setSlotViews: vi.fn().mockResolvedValue(appState),
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
    requestSession(sessionId: string) {
      for (const listener of navigationListeners) listener(sessionId);
    },
  };
}

beforeEach(() => {
  localStorage.clear();
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

/**
 * The live xterm mock behind a pane. Panes are keyed by session, so instance order says nothing
 * about which terminal belongs to which session — the attach replay does.
 */
function xtermFor(sessionId: string) {
  return waitFor(() => {
    const instance = terminalHarness.instances
      .filter((candidate) => candidate.write.mock.calls.some((call) => call[0] === `${sessionId} replay\r\n`))
      .at(-1);
    if (!instance) throw new Error(`No xterm attached for ${sessionId}`);
    return instance;
  });
}

describe("folder workspace", () => {
  it("loads opened folders and lays the restored folder's sessions out in the grid", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;

    render(<App />);

    expect(screen.getAllByText("작업 영역 불러오는 중")).toHaveLength(2);
    expect(await screen.findByRole("button", { name: "Atlas 폴더 선택" })).toBeInTheDocument();
    // The tree stops at the folder: sessions are panes, and the restored folder brings all of its
    // own onto the grid, most recently active first.
    expect(screen.getByRole("region", { name: "Claude Code" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "PowerShell" })).toBeInTheDocument();
    // The path belongs to the main window header now; the sidebar row keeps it as a tooltip only.
    expect(screen.getByText("C:\\work\\atlas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Atlas 폴더 선택" })).toHaveAttribute("title", "C:\\work\\atlas");
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

    fireEvent.click(await screen.findByRole("button", { name: "Atlas 폴더 선택" }));

    expect(await screen.findByRole("region", { name: "PowerShell 1" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "PowerShell 2" })).toBeInTheDocument();
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
    expect(document.querySelector(".grid-pane.pane-focused")).toHaveAttribute("aria-label", "PowerShell");
    expect(document.querySelector(".workspace-title")).toHaveTextContent("Dashboard");
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalledWith(dashboardSession.id));
  });

  it("renders a refresh button that reloads folders and sessions on click", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    expect(harness.api.projects.list).toHaveBeenCalledOnce();

    const refreshButton = screen.getByRole("button", { name: "목록 새로고침" });
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
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalledWith(dashboardSession.id));

    fireEvent.click(screen.getByRole("button", { name: "목록 새로고침" }));
    await waitFor(() => expect(harness.api.projects.list).toHaveBeenCalledTimes(2));

    expect(screen.getByRole("button", { name: "Dashboard 폴더 선택" }).closest(".project-row")).toHaveClass(
      "selected",
    );
    expect(document.querySelector(".grid-pane.pane-focused")).toHaveAttribute("aria-label", "PowerShell");
    expect(document.querySelector(".workspace-title")).toHaveTextContent("Dashboard");
  });

  it("falls back to another folder when the selected folder disappears during a manual refresh", async () => {
    const harness = createApi({ projects: [atlas, dashboard], sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    expect(screen.getByRole("button", { name: "Atlas 폴더 선택" }).closest(".project-row")).toHaveClass("selected");

    vi.mocked(harness.api.projects.list).mockResolvedValueOnce(registry([dashboard]));
    fireEvent.click(screen.getByRole("button", { name: "목록 새로고침" }));

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
    expect(document.querySelector(".grid-pane")).toBeNull();
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
    await screen.findByRole("region", { name: "PowerShell" });

    // Started outside the renderer — a jk-coding-cli spawn or a lazy auto-resume elsewhere.
    await act(async () => {
      harness.emit({
        type: "created",
        sessionId: "session-spawned",
        session: { ...powershellSession, id: "session-spawned", name: "스폰된 세션", status: "starting" },
      });
    });

    // It gets a tab straight away, but no slot: nothing already on screen is pushed off for it.
    const tab = await screen.findByRole("tab", { name: /스폰된 세션/ });
    expect(tab).toHaveClass("offscreen");
    expect(screen.queryByRole("region", { name: "스폰된 세션" })).not.toBeInTheDocument();

    // Clicking the tab is what gives it one.
    fireEvent.click(tab);
    expect(await screen.findByRole("region", { name: "스폰된 세션" })).toBeInTheDocument();
  });

  it("sends a new session to its own page instead of collapsing the grid onto it", async () => {
    const crowd = Array.from({ length: 6 }, (_, index): TerminalSessionView => ({
      ...powershellSession,
      id: `session-crowd-${index}`,
      createdAt: `2026-07-10T0${index}:00:00.000Z`,
      updatedAt: `2026-07-10T0${index}:00:00.000Z`,
    }));
    const harness = createApi({ sessions: crowd });
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Atlas 폴더 선택" }));
    await waitFor(() => expect(document.querySelector(".workspace-grid")).toHaveAttribute("data-slots", "6"));

    // The reported v1.13 bug: a seventh session folded the grid onto itself and the other six had
    // no way back but reopening the folder. Now it opens on a page of its own.
    fireEvent.click(screen.getByRole("button", { name: "새 PowerShell 세션" }));
    expect(await screen.findByRole("region", { name: "PowerShell 7" })).toBeInTheDocument();
    expect(screen.getByLabelText("2페이지 중 2페이지")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "이전 페이지" }));
    await waitFor(() => expect(document.querySelector(".workspace-grid")).toHaveAttribute("data-slots", "6"));
    expect(screen.getByRole("region", { name: "PowerShell 1" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "PowerShell 6" })).toBeInTheDocument();
  });

  it("names a session after the work it is doing, and carries its status onto the pane header", async () => {
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

    fireEvent.click(await screen.findByRole("button", { name: "Atlas 폴더 선택" }));

    const pane = await screen.findByRole("region", { name: "레지스트리 분리" });
    expect(pane.querySelector(".pane-header .status-dot")).toHaveClass("status-working");
    expect(
      screen.getByRole("region", { name: "PowerShell" }).querySelector(".pane-header .status-dot"),
    ).toHaveClass("status-idle");

    // A title that arrives mid-session renames the pane without a reload.
    await act(async () => {
      harness.emit({ type: "title", sessionId: powershellSession.id, title: "빌드 로그 확인" });
    });

    expect(await screen.findByRole("region", { name: "빌드 로그 확인" })).toBeInTheDocument();
  });

  it("renames a session from its pane's context menu and can hand the name back to the provider", async () => {
    const titled: TerminalSessionView = { ...claudeSession, id: "session-titled", title: "레지스트리 분리" };
    const harness = createApi({ sessions: [titled] });
    window.multiCliWork = harness.api;
    render(<App />);

    const pane = await screen.findByRole("region", { name: "레지스트리 분리" });
    fireEvent.contextMenu(pane.querySelector(".pane-header")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "이름 변경" }));

    const input = screen.getByLabelText("세션 이름");
    expect(input).toHaveValue("레지스트리 분리");
    fireEvent.change(input, { target: { value: "  내 작업  " } });
    fireEvent.submit(screen.getByRole("form", { name: "세션 이름 변경" }));

    await waitFor(() => expect(harness.api.terminals.rename).toHaveBeenCalledWith(titled.id, "내 작업"));
    const renamed = await screen.findByRole("region", { name: "내 작업" });

    fireEvent.contextMenu(renamed.querySelector(".pane-header")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "제공자 제목 사용" }));

    await waitFor(() => expect(harness.api.terminals.rename).toHaveBeenLastCalledWith(titled.id, null));
    expect(await screen.findByRole("region", { name: "레지스트리 분리" })).toBeInTheDocument();
  });

  it("keeps the grid's pane order steady when a pane takes focus or changes status", async () => {
    const second: TerminalSessionView = {
      ...powershellSession,
      id: "session-pwsh-second",
      createdAt: "2026-07-11T03:00:00.000Z",
      updatedAt: "2026-07-11T03:00:00.000Z",
    };
    const harness = createApi({ sessions: [powershellSession, second] });
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Atlas 폴더 선택" }));
    await screen.findByRole("region", { name: "PowerShell 2" });
    const order = () =>
      [...document.querySelectorAll(".grid-pane")].map((pane) => pane.getAttribute("aria-label"));
    // The grid fills most-recently-active first, and nothing after that reshuffles it.
    expect(order()).toEqual(["PowerShell 2", "PowerShell 1"]);

    fireEvent.mouseDown(screen.getByRole("region", { name: "PowerShell 1" }));
    await act(async () => {
      harness.emit({ type: "status", sessionId: second.id, status: "working" });
    });

    expect(order()).toEqual(["PowerShell 2", "PowerShell 1"]);
  });

  it("updates a CLI in a maintenance session that belongs to no folder", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    // The 🔧 header menu is gone; the title bar's 도구 menu is the single way in.
    fireEvent.click(screen.getByRole("menuitem", { name: "도구" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Claude Code 업데이트" }));

    await waitFor(() =>
      expect(harness.api.terminals.createTool).toHaveBeenCalledWith({ tool: "claude-update", cols: 80, rows: 24 }),
    );
    expect(harness.api.terminals.select).toHaveBeenCalledWith(null, toolSession.id);
    // A tool belongs to no folder, so it takes the grid rather than joining the folder's panes.
    expect(await screen.findByRole("region", { name: "Claude Code 업데이트" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "PowerShell" })).not.toBeInTheDocument();
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
    expect(document.querySelector(".grid-pane.pane-focused")).toHaveAttribute(
      "aria-label",
      "Claude Code 업데이트",
    );
    expect(document.querySelector(".workspace-title")).toHaveTextContent("도구");
  });

  it("keeps the Tools menu usable when no folder is open, but not for a missing CLI", async () => {
    const harness = createApi({ projects: [], sessions: [] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByText("아직 프로젝트가 없습니다");
    fireEvent.click(screen.getByRole("menuitem", { name: "도구" }));

    // Codex is absent in this harness, so its update must not be offered.
    expect(await screen.findByRole("menuitem", { name: "Codex 업데이트" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Claude Code 업데이트" }));

    await waitFor(() =>
      expect(harness.api.terminals.createTool).toHaveBeenCalledWith({ tool: "claude-update", cols: 80, rows: 24 }),
    );
  });

  it("manually resumes, stops, and removes a finished session from its pane", async () => {
    const harness = createApi({ sessions: [claudeSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "Claude Code" });
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
    // Removal is a confirm-first action, so it lives in the pane's context menu, not on a button.
    fireEvent.contextMenu(document.querySelector(".pane-header")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "제거" }));
    const dialog = await screen.findByRole("dialog", { name: "세션 제거" });
    fireEvent.click(within(dialog).getByRole("button", { name: "제거" }));

    await waitFor(() => expect(harness.api.terminals.remove).toHaveBeenCalledWith(claudeSession.id));
    expect(harness.api.terminals.select).toHaveBeenLastCalledWith(atlas.id, null);
    expect(screen.getByText("Atlas에 세션이 없습니다")).toBeInTheDocument();
  });

  it("keeps the terminal grid in a dedicated flexible workspace body", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    const terminalRegion = await screen.findByRole("region", { name: "powershell 터미널" });
    // The tab bar, the layout row and the grid share one flexible column inside the body.
    const panes = terminalRegion.closest(".workspace-grid")!.parentElement!;
    expect(panes).toHaveClass("workspace-panes");
    expect(panes.parentElement).toHaveClass("workspace-body");
  });

  it("attaches replay, forwards input and live output, and resizes the PTY", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "powershell 터미널" });
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

  it("filters synchronized clear-screen commands from replay and live terminal output", async () => {
    const harness = createApi({
      sessions: [codexSession],
      selection: { selectedProjectId: atlas.id, selectedSessionId: codexSession.id },
    });
    const syncStart = "\u001b[?2026h";
    const syncEnd = "\u001b[?2026l";
    vi.mocked(harness.api.terminals.attach).mockResolvedValue({
      session: codexSession,
      replay: `${syncStart}\u001b[2Jreplay frame${syncEnd}`,
      sequence: 1,
    });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "codex 터미널" });
    const terminal = terminalHarness.instances.at(-1)!;
    await waitFor(() => expect(terminal.write).toHaveBeenCalledWith(`${syncStart}replay frame${syncEnd}`));

    await act(async () => {
      harness.emit({ type: "data", sessionId: codexSession.id, data: syncStart, sequence: 2 });
      harness.emit({ type: "data", sessionId: codexSession.id, data: "\u001b[", sequence: 3 });
      harness.emit({ type: "data", sessionId: codexSession.id, data: `2Jlive frame${syncEnd}`, sequence: 4 });
      harness.emit({ type: "data", sessionId: codexSession.id, data: "\u001b[2J", sequence: 5 });
    });

    expect(terminal.write).toHaveBeenCalledWith(syncStart);
    expect(terminal.write).toHaveBeenCalledWith(`live frame${syncEnd}`);
    expect(terminal.write).toHaveBeenCalledWith("\u001b[2J");
    expect(terminal.write).not.toHaveBeenCalledWith("\u001b[");
    expect(terminal.write).not.toHaveBeenCalledWith(`2Jlive frame${syncEnd}`);
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

    expect(await screen.findByText("아직 프로젝트가 없습니다")).toBeInTheDocument();
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
    expect(document.querySelector(".grid-pane")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Atlas 폴더 선택" }));
    expect(screen.queryByRole("region", { name: "홈 대시보드" })).not.toBeInTheDocument();
  });

  it("reaches the project detail page from the header rather than on the folder click", async () => {
    const harness = createApi({ sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    // Clicking the folder fills the grid with its terminals — the detail page is a button away.
    await screen.findByRole("region", { name: "powershell 터미널" });
    fireEvent.click(screen.getByRole("button", { name: "Atlas 폴더 선택" }));
    expect(screen.getByRole("region", { name: "powershell 터미널" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "폴더 상세" }));

    expect(screen.getByRole("region", { name: "프로젝트 상세" })).toBeInTheDocument();
    expect(document.querySelector(".grid-pane")).toBeNull();
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
   * Session labels used to index a fixed provider table by kind, so a session whose agent was no
   * longer listed took the whole view down. It now falls back to the agent's id.
   */
  it("still opens a session whose agent was removed from agents.json", async () => {
    const harness = createApi({
      sessions: [removedAgentSession],
      selection: { selectedProjectId: atlas.id, selectedSessionId: null },
    });
    window.multiCliWork = harness.api;
    render(<App />);

    expect(await screen.findByRole("region", { name: "gemini" })).toBeInTheDocument();
  });
});

describe("work project categories", () => {
  const workProject = (id: string, name: string, category: string, extra?: Partial<WorkProject>): WorkProject => ({
    id,
    name,
    category,
    status: "진행중",
    memo: "",
    notionLinks: [],
    localFolders: [],
    members: [],
    order: 0,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    ...extra,
  });

  // The home dashboard cards carry the same aria-label, so every lookup is scoped to the sidebar.
  const groupOf = async (name: string) => {
    const nav = await screen.findByRole("navigation", { name: "프로젝트" });
    return (await within(nav).findByRole("button", { name: `${name} 프로젝트 열기` })).closest(
      ".work-project-node",
    )!;
  };

  it("gives each 구분 its own accent class, and the rail covers the folders inside", async () => {
    const harness = createApi({
      projects: [atlas, dashboard],
      sessions: [],
      workProjects: [
        workProject("wp-grant", "스마트팩토리 과제", "정부지원과제", {
          members: [{ projectId: atlas.id, role: "repo" }],
        }),
        workProject("wp-vendor", "A사 관제", "외주개발", { order: 1 }),
      ],
    });
    window.multiCliWork = harness.api;
    render(<App />);

    const grant = await groupOf("스마트팩토리 과제");
    expect(grant).toHaveClass("category-government", "categorized");
    // The folder sits inside the group node, so the rail on that node runs past it.
    expect(grant.querySelector(".project-row")).toBeInTheDocument();
    expect(await groupOf("A사 관제")).toHaveClass("category-outsourcing");
  });

  it("marks a member folder with the brand of what it holds — Teams for 문서, GitHub for 레포", async () => {
    const harness = createApi({
      projects: [atlas, dashboard],
      sessions: [],
      workProjects: [
        workProject("wp-grant", "스마트팩토리 과제", "정부지원과제", {
          members: [
            { projectId: atlas.id, role: "repo" },
            { projectId: dashboard.id, role: "docs" },
          ],
        }),
      ],
    });
    window.multiCliWork = harness.api;
    render(<App />);

    const group = (await groupOf("스마트팩토리 과제")) as HTMLElement;
    const folder = (name: string) => within(group).getByRole("button", { name: `${name} 폴더 선택` });

    expect(folder("Atlas").querySelector(".brand-icon-github")).toBeInTheDocument();
    expect(folder("Dashboard").querySelector(".brand-icon-teams")).toBeInTheDocument();
  });

  it("leaves a 미분류 folder on the plain folder icon, having no role to brand it with", async () => {
    const harness = createApi({
      projects: [atlas],
      sessions: [],
      workProjects: [workProject("wp-grant", "스마트팩토리 과제", "정부지원과제")],
    });
    window.multiCliWork = harness.api;
    render(<App />);

    const folder = await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    expect(folder.querySelector(".brand-icon-github")).not.toBeInTheDocument();
    expect(folder.querySelector(".brand-icon-teams")).not.toBeInTheDocument();
    expect(folder.querySelector("svg")).toBeInTheDocument();
  });

  it("leaves the 구분 to the colour in the sidebar, spelling it out on the home card instead", async () => {
    const harness = createApi({
      projects: [],
      sessions: [],
      workProjects: [workProject("wp-product", "사내 제품", "상품개발")],
    });
    window.multiCliWork = harness.api;
    render(<App />);

    const group = (await groupOf("사내 제품")) as HTMLElement;
    expect(group).toHaveClass("category-product");
    // groupOf scopes to the sidebar nav, so the home card's chip cannot satisfy this.
    expect(within(group).queryByText("상품개발")).not.toBeInTheDocument();
    // The word itself still exists on screen — just not in the sidebar.
    expect(screen.getByText("상품개발")).toHaveClass("category-chip");
  });

  it("reads a legacy or custom 구분 as 기타 rather than dropping the colour", async () => {
    const harness = createApi({
      projects: [],
      sessions: [],
      workProjects: [workProject("wp-legacy", "사내연구 과제", "사내연구")],
    });
    window.multiCliWork = harness.api;
    render(<App />);

    expect(await groupOf("사내연구 과제")).toHaveClass("category-etc");
  });

  it("dims a 완료 group so live work stays in front", async () => {
    const harness = createApi({
      projects: [],
      sessions: [],
      workProjects: [
        workProject("wp-done", "종료된 과제", "정부지원과제", { status: "완료" }),
        workProject("wp-live", "진행 과제", "정부지원과제", { order: 1 }),
      ],
    });
    window.multiCliWork = harness.api;
    render(<App />);

    expect(await groupOf("종료된 과제")).toHaveClass("dormant");
    expect(await groupOf("진행 과제")).not.toHaveClass("dormant");
  });

  it("gives the home dashboard card the same accent as the sidebar group", async () => {
    const harness = createApi({
      projects: [],
      sessions: [],
      workProjects: [
        workProject("wp-vendor", "A사 관제", "외주개발"),
        workProject("wp-done", "종료된 과제", "기타", { status: "보관", order: 1 }),
      ],
    });
    window.multiCliWork = harness.api;
    render(<App />);

    const home = within(await screen.findByRole("region", { name: "업무 프로젝트" }));
    const card = (await home.findByRole("button", { name: "A사 관제 프로젝트 열기" })).closest(
      ".work-project-card",
    )!;
    expect(card).toHaveClass("category-outsourcing");
    expect(card).not.toHaveClass("dormant");
    expect(
      home.getByRole("button", { name: "종료된 과제 프로젝트 열기" }).closest(".work-project-card"),
    ).toHaveClass("category-etc", "dormant");
  });

  it("leaves the tree unrailed when no work project exists at all", async () => {
    const harness = createApi({ projects: [atlas], sessions: [] });
    window.multiCliWork = harness.api;
    render(<App />);

    const node = (await screen.findByRole("button", { name: "Atlas 폴더 선택" })).closest(".work-project-node")!;
    expect(node).not.toHaveClass("categorized");
  });
});

describe("file viewer", () => {
  const markdownEntry: FileTreeEntry = {
    name: "README.md",
    relativePath: "README.md",
    kind: "file",
    extension: "md",
    executable: false,
  };

  it("serializes rapid Markdown task saves and keeps a failed optimistic change retryable", async () => {
    const harness = createApi({ sessions: [] });
    vi.mocked(harness.api.workspaceFiles.listDirectory).mockResolvedValue([markdownEntry]);
    vi.mocked(harness.api.workspaceFiles.readFile).mockResolvedValue({
      relativePath: "README.md",
      encoding: "utf8",
      content: "- [ ] first\n- [ ] second\n",
      truncated: false,
      sizeBytes: 27,
    });
    const writes: Array<{ content: string; resolve(): void; reject(error: Error): void }> = [];
    vi.mocked(harness.api.workspaceFiles.writeFile).mockImplementation((_target, _path, content) =>
      new Promise<void>((resolve, reject) => writes.push({ content, resolve, reject })),
    );
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "README.md" }));
    const first = (await screen.findAllByRole("checkbox"))[0];
    fireEvent.click(first);
    await waitFor(() => expect(writes).toHaveLength(1));
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    expect(writes).toHaveLength(1);
    expect(screen.getAllByRole<HTMLInputElement>("checkbox").every((box) => box.checked)).toBe(true);

    await act(async () => writes[0].resolve());
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes.map((write) => write.content)).toEqual([
      "- [x] first\n- [ ] second\n",
      "- [x] first\n- [x] second\n",
    ]);
    await act(async () => writes[1].reject(new Error("disk full")));

    expect(await screen.findByRole("alert")).toHaveTextContent("disk full");
    expect(screen.getAllByRole<HTMLInputElement>("checkbox").every((box) => box.checked)).toBe(true);
    const retry = screen.getByRole("button", { name: "저장" });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await waitFor(() => expect(writes).toHaveLength(3));
    await act(async () => writes[2].resolve());
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("opens normalized relative Markdown links in an existing file-tab flow", async () => {
    const harness = createApi({ sessions: [] });
    vi.mocked(harness.api.workspaceFiles.listDirectory).mockResolvedValue([markdownEntry]);
    vi.mocked(harness.api.workspaceFiles.readFile).mockImplementation(async (_target, relativePath) => ({
      relativePath,
      encoding: "utf8",
      content: relativePath === "README.md" ? "[Guide](docs/guide.md)" : "# Guide title",
      truncated: false,
      sizeBytes: 24,
    }));
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "README.md" }));
    fireEvent.click(await screen.findByRole("link", { name: "Guide" }));
    expect(await screen.findByRole("heading", { name: "Guide title" })).toBeInTheDocument();
    expect(harness.api.workspaceFiles.readFile).toHaveBeenLastCalledWith(
      { kind: "project", id: atlas.id },
      "docs/guide.md",
    );

    fireEvent.click(screen.getByRole("button", { name: "README.md 파일 열기" }));
    fireEvent.click(await screen.findByRole("link", { name: "Guide" }));
    expect(harness.api.workspaceFiles.readFile).toHaveBeenCalledTimes(2);
  });

  it("saves ordinary UTF-8 text with the shared dirty and saving states", async () => {
    const harness = createApi({ sessions: [] });
    const notes: FileTreeEntry = {
      name: "notes.txt",
      relativePath: "notes.txt",
      kind: "file",
      extension: "txt",
      executable: false,
    };
    vi.mocked(harness.api.workspaceFiles.listDirectory).mockResolvedValue([notes]);
    vi.mocked(harness.api.workspaceFiles.readFile).mockResolvedValue({
      relativePath: "notes.txt",
      encoding: "utf8",
      content: "old",
      truncated: false,
      sizeBytes: 3,
    });
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "notes.txt" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "notes.txt 편집" }), { target: { value: "new" } });
    const save = screen.getByRole("button", { name: "저장" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(harness.api.workspaceFiles.writeFile).toHaveBeenCalledWith(
      { kind: "project", id: atlas.id },
      "notes.txt",
      "new",
    ));
    await waitFor(() => expect(screen.getByRole("button", { name: "저장" })).toBeDisabled());
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
    // A folder opens into its grid, which is empty here — every session belongs to Atlas.
    expect(await screen.findByText("Dashboard에 세션이 없습니다")).toBeInTheDocument();

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
  it("rolls an off-screen session's wait up onto its folder row, and clears it afterwards", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("button", { name: "Atlas 폴더 선택" });

    // Claude Code sits behind the grid here, so the folder row is the only place left to say so.
    act(() => harness.emitAttention({ [claudeSession.id]: "approval" }));

    expect(screen.getByRole("status", { name: "응답 대기 세션 있음" })).toBeInTheDocument();

    act(() => harness.emitAttention({}));

    expect(screen.queryByRole("status", { name: "응답 대기 세션 있음" })).not.toBeInTheDocument();
  });
});

describe("notification navigation", () => {
  it("selects and reveals the session requested by main", async () => {
    const harness = createApi({ sessions: [powershellSession, claudeSession] });
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("region", { name: "PowerShell" });

    act(() => harness.requestSession(claudeSession.id));

    await waitFor(() => expect(harness.api.terminals.select).toHaveBeenLastCalledWith(atlas.id, claudeSession.id));
    expect(document.querySelector(".grid-pane.pane-focused")).toHaveAttribute("aria-label", "Claude Code");
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

  it("nests worktree sessions under a third tree level and scopes the grid and detail page to it", async () => {
    const harness = createApi({
      sessions: [powershellSession, worktreeSession],
      worktrees: [atlasWorktree],
      selection: { selectedProjectId: atlas.id, selectedSessionId: null },
    });
    window.multiCliWork = harness.api;
    render(<App />);

    const worktreeButton = await screen.findByRole("button", { name: "feature-x worktree 선택" });
    fireEvent.click(worktreeButton);

    // A worktree behaves like a folder: it fills the grid with its own sessions and nothing else.
    expect(await screen.findByRole("region", { name: "WT 세션" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "PowerShell" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "폴더 상세" }));
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
    fireEvent.click(screen.getByRole("button", { name: "폴더 상세" }));
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

describe("workspace grid", () => {
  it("opens a folder straight into a grid of its sessions, most recent first", async () => {
    // Boots on Dashboard, which owns no session at all, so the grid starts empty.
    const harness = createApi({
      projects: [atlas, dashboard],
      selection: { selectedProjectId: dashboard.id, selectedSessionId: null },
    });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    expect(screen.queryByRole("region", { name: "powershell 터미널" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Atlas 폴더 선택" }));

    expect(await screen.findByRole("region", { name: "claude 터미널" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "powershell 터미널" })).toBeInTheDocument();
    expect(harness.api.terminals.setVisibleSessions).toHaveBeenLastCalledWith([
      claudeSession.id,
      powershellSession.id,
    ]);
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalledWith(claudeSession.id));
  });

  it("empties a slot without ending the session, and the tab puts it back", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Atlas 폴더 선택" }));
    await screen.findByRole("region", { name: "claude 터미널" });

    // The first pane is the most recent session — Claude Code.
    fireEvent.click(screen.getAllByRole("button", { name: "슬롯 비우기" })[0]!);
    expect(screen.queryByRole("region", { name: "claude 터미널" })).not.toBeInTheDocument();
    expect(harness.api.terminals.setVisibleSessions).toHaveBeenLastCalledWith([powershellSession.id]);
    expect(harness.api.terminals.stop).not.toHaveBeenCalled();
    expect(harness.api.terminals.remove).not.toHaveBeenCalled();

    // The tab outlives the slot, so one click is the whole way back — no swap menu in between.
    fireEvent.click(screen.getByRole("tab", { name: /Claude Code/ }));

    expect(await screen.findByRole("region", { name: "claude 터미널" })).toBeInTheDocument();
    expect(harness.api.terminals.setVisibleSessions).toHaveBeenLastCalledWith([
      powershellSession.id,
      claudeSession.id,
    ]);
  });

  it("points the sidebar at the folder a clicked tab belongs to, then lets go of it", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Atlas 폴더 선택" }));
    await screen.findByRole("region", { name: "claude 터미널" });
    const row = screen.getByRole("button", { name: "Atlas 폴더 선택" }).closest(".project-row")!;
    expect(row).not.toHaveClass("flash");

    // A workspace mixes folders, so a tab says where its pane came from — briefly, then quietly.
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("tab", { name: /PowerShell/ }));
      expect(row).toHaveClass("flash");

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(row).not.toHaveClass("flash");
    } finally {
      vi.useRealTimers();
    }
  });

  it("recreates xterm and uses refresh without stopping or resuming the selected session", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "powershell 터미널" });
    await waitFor(() => expect(harness.api.terminals.attach).toHaveBeenCalledWith(powershellSession.id));
    const previous = await xtermFor(powershellSession.id);

    // Every pane carries its own refresh button, so the click has to name the pane it means.
    fireEvent.click(
      within(screen.getByRole("region", { name: "PowerShell" })).getByRole("button", { name: "세션 새로고침" }),
    );

    await waitFor(() => expect(harness.api.terminals.refresh).toHaveBeenCalledWith(powershellSession.id));
    // The replacement is the xterm that replayed the refreshed scrollback — with a grid of panes,
    // the newest instance on the list says nothing about which session it belongs to.
    const replacement = await waitFor(() => {
      const instance = terminalHarness.instances.find((candidate) =>
        candidate.write.mock.calls.some((call) => call[0] === `${powershellSession.id} refreshed\r\n`),
      );
      if (!instance) throw new Error("No refreshed xterm yet");
      return instance;
    });
    expect(replacement).not.toBe(previous);
    expect(previous.dispose).toHaveBeenCalledOnce();
    expect(harness.api.terminals.stop).not.toHaveBeenCalled();
    expect(harness.api.terminals.resume).not.toHaveBeenCalled();
  });

  it("refreshes an exited session's scrollback without resuming it", async () => {
    const harness = createApi({
      sessions: [claudeSession],
      selection: { selectedProjectId: atlas.id, selectedSessionId: claudeSession.id },
    });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "claude 터미널" });
    fireEvent.click(screen.getByRole("button", { name: "세션 새로고침" }));

    await waitFor(() => expect(harness.api.terminals.refresh).toHaveBeenCalledWith(claudeSession.id));
    expect(harness.api.terminals.resume).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "세션 재개" })).toBeInTheDocument();
  });

  it("refreshes only the pane whose header opened the menu, and leaves the focus where it was", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Atlas 폴더 선택" }));
    await screen.findByRole("region", { name: "claude 터미널" });
    // The first pane is the most recent session — Claude Code — and it holds the focus.
    const focused = await xtermFor(claudeSession.id);
    const other = await xtermFor(powershellSession.id);

    fireEvent.contextMenu(screen.getByRole("region", { name: "PowerShell" }).querySelector(".pane-header")!);
    fireEvent.click(screen.getByRole("menuitem", { name: "새로고침" }));

    await waitFor(() => expect(harness.api.terminals.refresh).toHaveBeenCalledWith(powershellSession.id));
    expect(other.dispose).toHaveBeenCalledOnce();
    expect(focused.dispose).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "claude 터미널" })).toBeInTheDocument();
    // Acting on a pane is not selecting it: the keyboard stays with the pane that had it.
    expect(document.querySelector(".grid-pane.pane-focused")).toHaveAttribute("aria-label", "Claude Code");
  });

  it("shows refresh failures and restores the pane button's busy state", async () => {
    const harness = createApi();
    vi.mocked(harness.api.terminals.refresh).mockRejectedValueOnce(new Error("refresh unavailable"));
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "powershell 터미널" });
    const button = within(screen.getByRole("region", { name: "PowerShell" })).getByRole("button", {
      name: "세션 새로고침",
    });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(await screen.findByRole("alert")).toHaveTextContent("refresh unavailable");
    await waitFor(() => expect(button).toBeEnabled());
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
    fireEvent.click(screen.getByRole("button", { name: "폴더 상세" }));
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

    // A drop lands in the pane it was aimed at, and the folder's grid holds more than one.
    const host = screen.getByRole("region", { name: "PowerShell" }).querySelector(".terminal-host")!;
    fireEvent.drop(host, {
      dataTransfer: {
        types: ["Files"],
        files: [new File(["x"], "shot.png"), new File(["y"], "notes.md")],
      },
    });

    const terminal = await xtermFor(powershellSession.id);
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

describe("title bar", () => {
  const openMenu = (label: string) => {
    // A real press begins with mousedown, and that is what dismisses a menu left open elsewhere —
    // without it the click below would toggle the already-open menu shut instead.
    fireEvent.mouseDown(document.body);
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
    return screen.findByRole("menu", { name: label });
  };
  const terminalHost = (name: string) =>
    screen.getByRole("region", { name }).querySelector(".terminal-host")!;

  it("sends 편집 menu commands to the terminal that last took the keyboard", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "powershell 터미널" });
    // Opening the folder puts both of its sessions on screen, side by side.
    fireEvent.click(screen.getByRole("button", { name: "Atlas 폴더 선택" }));
    await screen.findByRole("region", { name: "claude 터미널" });
    const primary = await xtermFor(powershellSession.id);
    const secondary = await xtermFor(claudeSession.id);
    secondary.selection = "claude output";

    fireEvent.focusIn(terminalHost("claude 터미널"));
    fireEvent.click(within(await openMenu("편집")).getByRole("menuitem", { name: /복사/ }));
    await waitFor(() => expect(harness.api.clipboard.writeText).toHaveBeenCalledWith("claude output"));

    // Nothing about the grid changed — only which pane holds the keyboard.
    fireEvent.focusIn(terminalHost("powershell 터미널"));
    fireEvent.click(within(await openMenu("편집")).getByRole("menuitem", { name: /모두 선택/ }));
    expect(primary.selectAll).toHaveBeenCalledOnce();
    expect(secondary.selectAll).not.toHaveBeenCalled();

    fireEvent.click(within(await openMenu("편집")).getByRole("menuitem", { name: "터미널 지우기" }));
    expect(primary.clear).toHaveBeenCalledOnce();
  });

  it("greys the 편집 menu out once no terminal is on screen", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("region", { name: "powershell 터미널" });
    expect(within(await openMenu("편집")).getByRole("menuitem", { name: /복사/ })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "홈 대시보드 열기" }));
    expect(within(await openMenu("편집")).getByRole("menuitem", { name: /복사/ })).toBeDisabled();
  });

  it("quits through the app rather than the tray, and folds the sidebar from 보기", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("button", { name: "Atlas 폴더 선택" });

    fireEvent.click(within(await openMenu("파일")).getByRole("menuitem", { name: "종료" }));
    expect(harness.api.window.quit).toHaveBeenCalledOnce();
    // ✕ hides to the tray; 종료 must not take that path.
    expect(harness.api.window.close).not.toHaveBeenCalled();

    const shell = document.querySelector(".app-shell")!;
    expect(shell).not.toHaveClass("sidebar-collapsed");
    fireEvent.click(within(await openMenu("보기")).getByRole("menuitem", { name: "왼쪽 사이드바 접기" }));
    expect(shell).toHaveClass("sidebar-collapsed");
    fireEvent.click(within(await openMenu("보기")).getByRole("menuitem", { name: "왼쪽 사이드바 펼치기" }));
    expect(shell).not.toHaveClass("sidebar-collapsed");
  });

  it("launches a session from the 세션 submenu and names the running version in 도움말", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("region", { name: "powershell 터미널" });

    fireEvent.click(within(await openMenu("세션")).getByRole("menuitem", { name: /새 세션/ }));
    const submenu = await screen.findByRole("menu", { name: "새 세션" });
    expect(within(submenu).getByRole("menuitem", { name: "Codex" })).toBeDisabled();
    fireEvent.click(within(submenu).getByRole("menuitem", { name: "Claude Code" }));

    await waitFor(() =>
      expect(harness.api.terminals.create).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: atlas.id, kind: "claude" }),
      ),
    );

    expect(within(await openMenu("도움말")).getByRole("menuitem", { name: "버전 v1.0.0" })).toBeDisabled();
  });

  it("names the open folder in the command centre, opens quick open, and marks a waiting session", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("region", { name: "powershell 터미널" });

    const commandCentre = screen.getByRole("button", { name: "빠른 열기" });
    expect(commandCentre).toHaveTextContent("Atlas");
    fireEvent.click(commandCentre);
    expect(await screen.findByRole("dialog", { name: "빠른 열기" })).toBeInTheDocument();

    await act(async () => {
      harness.emitAttention({ [claudeSession.id]: "approval" });
    });
    expect(screen.getByRole("status", { name: "승인을 기다리는 세션이 있습니다" })).toHaveTextContent("!");
  });

  it("keeps the accelerators the native menu used to own", async () => {
    const harness = createApi();
    window.multiCliWork = harness.api;
    render(<App />);
    await screen.findByRole("button", { name: "Atlas 폴더 선택" });

    fireEvent.keyDown(window, { key: "F11" });
    fireEvent.keyDown(window, { key: "F12" });
    fireEvent.keyDown(window, { key: "=", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "-", ctrlKey: true });
    fireEvent.keyDown(window, { key: "0", ctrlKey: true });

    expect(harness.api.window.toggleFullScreen).toHaveBeenCalledOnce();
    expect(harness.api.window.toggleDevTools).toHaveBeenCalledOnce();
    expect(harness.api.window.zoom).toHaveBeenNthCalledWith(1, "in");
    expect(harness.api.window.zoom).toHaveBeenNthCalledWith(2, "out");
    expect(harness.api.window.zoom).toHaveBeenNthCalledWith(3, "reset");
    // Ctrl+R stays off the keyboard: a mistyped reload would drop every attached terminal.
    fireEvent.keyDown(window, { key: "r", ctrlKey: true });
    expect(harness.api.window.reload).not.toHaveBeenCalled();
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

describe("folder colour", () => {
  const archive: SharedProject = {
    ...atlas,
    id: "project-archive",
    rootPath: "C:\\work\\archive",
    displayName: "Archive",
    status: "완료",
    order: 2,
  };

  const workProject = (id: string, name: string, memberId: string, order: number): WorkProject => ({
    id,
    name,
    category: "정부지원과제",
    status: "진행중",
    memo: "",
    notionLinks: [],
    localFolders: [],
    members: [{ projectId: memberId, role: "repo" }],
    order,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  });

  const folderRow = (name: string) => screen.getByRole("button", { name: `${name} 폴더 선택` }).closest(".project-row")!;
  const folderNode = (name: string) =>
    screen.getByRole("button", { name: `${name} 폴더 선택` }).closest(".project-node")!;
  // Home dashboard cards carry the same aria-label, so group lookups stay scoped to the sidebar.
  const groupNode = (name: string) =>
    within(screen.getByRole("navigation", { name: "프로젝트" }))
      .getByRole("button", { name: `${name} 프로젝트 열기` })
      .closest(".work-project-node")!;

  it("follows the folder's own agents rather than a hand-set flag", async () => {
    const harness = createApi({ projects: [atlas], sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    expect(folderRow("Atlas")).toHaveClass("folder-idle");

    // Amber is "an agent is doing something right now", and nothing else says so.
    await act(async () => {
      harness.emit({ type: "status", sessionId: powershellSession.id, status: "working" });
    });
    await waitFor(() => expect(folderRow("Atlas")).toHaveClass("folder-active"));

    await act(async () => {
      harness.emit({ type: "status", sessionId: powershellSession.id, status: "idle" });
    });
    await waitFor(() => expect(folderRow("Atlas")).toHaveClass("folder-idle"));
    // The pane keeps its own colour throughout — a pane's dot is the PTY's business alone.
    expect(document.querySelector(".pane-header .status-dot")).toHaveClass("status-idle");
  });

  it("leaves the registry's 완료 flag out of it, and offers no toggle for it", async () => {
    const done: SharedProject = { ...atlas, status: "완료" };
    const harness = createApi({ projects: [done], sessions: [powershellSession] });
    window.multiCliWork = harness.api;
    render(<App />);

    // v1.14 dropped the hand-set toggle: a second, manual record of what the sessions already say.
    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    expect(folderRow("Atlas")).toHaveClass("folder-idle");
    expect(screen.queryByRole("button", { name: "Atlas 작업 완료로 표시" })).not.toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole("button", { name: "Atlas 폴더 선택" }));
    await screen.findByRole("menu");
    expect(screen.queryByRole("menuitem", { name: "작업 완료로 표시" })).not.toBeInTheDocument();
    expect(harness.api.projects.update).not.toHaveBeenCalled();
  });

  it("keeps folders with a running agent open and closes the rest, across the group and folder layers alike", async () => {
    const working: TerminalSessionView = { ...powershellSession, status: "working" };
    const harness = createApi({
      projects: [atlas, dashboard, archive],
      // Only Atlas has an agent running, so only Atlas — and the group holding it — stays open.
      sessions: [working],
      workProjects: [workProject("wp-live", "진행 과제", atlas.id, 0), workProject("wp-archive", "끝난 과제", archive.id, 1)],
    });
    window.multiCliWork = harness.api;
    render(<App />);

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    fireEvent.click(screen.getByTitle("작업중인 폴더만 펼치고 나머지는 접기"));

    await waitFor(() => expect(groupNode("끝난 과제")).toHaveAttribute("aria-expanded", "false"));
    expect(groupNode("진행 과제")).toHaveAttribute("aria-expanded", "true");
    expect(folderNode("Atlas")).toHaveAttribute("aria-expanded", "true");
    // Dashboard is 미분류 and idle, so it closes on its own without a group to close it.
    expect(folderNode("Dashboard")).toHaveAttribute("aria-expanded", "false");
  });

  it("collapses and re-expands both layers at once, and remembers it across a restart", async () => {
    const harness = createApi({
      projects: [atlas, dashboard],
      sessions: [],
      workProjects: [workProject("wp-live", "진행 과제", atlas.id, 0)],
    });
    window.multiCliWork = harness.api;
    const view = render(<App />);

    await screen.findByRole("button", { name: "Atlas 폴더 선택" });
    fireEvent.click(screen.getByTitle("모든 프로젝트와 폴더 접기"));

    await waitFor(() => expect(groupNode("진행 과제")).toHaveAttribute("aria-expanded", "false"));
    expect(folderNode("Dashboard")).toHaveAttribute("aria-expanded", "false");

    // What persists is the collapsed set on both keys, so the arrangement survives a restart.
    view.unmount();
    const restart = createApi({
      projects: [atlas, dashboard],
      sessions: [],
      workProjects: [workProject("wp-live", "진행 과제", atlas.id, 0)],
    });
    window.multiCliWork = restart.api;
    render(<App />);

    await screen.findByRole("button", { name: "Dashboard 폴더 선택" });
    expect(groupNode("진행 과제")).toHaveAttribute("aria-expanded", "false");
    expect(folderNode("Dashboard")).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByTitle("모든 프로젝트와 폴더 펼치기"));

    await waitFor(() => expect(groupNode("진행 과제")).toHaveAttribute("aria-expanded", "true"));
    expect(folderNode("Atlas")).toHaveAttribute("aria-expanded", "true");
    expect(folderNode("Dashboard")).toHaveAttribute("aria-expanded", "true");
  });
});
