// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { registerMainIpc, type IpcRegistrar } from "./ipc";

function setup(options: { onSessionSelected?: (sessionId: string | null) => void } = {}) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc: IpcRegistrar = {
    handle: (channel, listener) => {
      handlers.set(channel, listener);
    },
  };
  const project = {
    id: "project-1",
    rootPath: "C:\\Work",
    displayName: "Work",
    sources: ["manual" as const],
    providerRefs: { claude: [], codex: [] },
    status: null,
    memo: "",
    tracks: [],
    hidden: false,
    order: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  };
  const registry = { schemaVersion: 1 as const, updatedAt: project.updatedAt, projects: { [project.id]: project } };
  const calls: string[] = [];
  const projectService = {
    findMissingProjectRoots: vi.fn(async () => [project.id]),
    registerManualFolder: vi.fn(async () => registry),
    updateProjectMetadata: vi.fn(async () => registry),
    removeProject: vi.fn(async () => {
      calls.push("removeProject");
      return registry;
    }),
    relinkProject: vi.fn(async () => registry),
  };
  const coordinator = {
    list: vi.fn(() => []),
    create: vi.fn(async (input) => input),
    createTool: vi.fn(async (input) => input),
    attachForRenderer: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    stop: vi.fn(),
    resume: vi.fn(),
    remove: vi.fn(),
    removeProjectSessions: vi.fn(async () => {
      calls.push("removeProjectSessions");
    }),
    rename: vi.fn(async (sessionId: string, name: string | null) => ({ id: sessionId, name })),
    select: vi.fn(),
    split: vi.fn(async (sessionId: string | null) => ({ splitSessionId: sessionId })),
    state: vi.fn(async () => ({
      source: "primary" as const,
      writable: true,
      state: {
        schemaVersion: 1 as const,
        updatedAt: project.updatedAt,
        selectedProjectId: project.id,
        selectedSessionId: null,
        sessions: {},
      },
    })),
  };
  const restoreRegistryBackup = vi.fn(async () => undefined);
  const updater = {
    status: vi.fn(() => ({ state: "downloaded" as const, version: "1.1.0" })),
    check: vi.fn(async () => undefined),
    install: vi.fn(async () => undefined),
    openReleases: vi.fn(() => undefined),
    openRepository: vi.fn(() => undefined),
  };
  const projectActions = {
    reveal: vi.fn(async () => undefined),
    openInEditor: vi.fn(async () => undefined),
    openOnGitHub: vi.fn(async () => undefined),
    gitStatus: vi.fn(async () => ({ isRepo: true, branch: "main", changedFileCount: 0 })),
    gitDiff: vi.fn(async () => ({ isRepo: true, diff: "", untracked: [], truncated: false })),
  };
  const worktree = {
    id: "worktree-1",
    projectId: project.id,
    path: "C:\\Work-wt\\feature",
    branch: "feature",
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
  const worktrees = {
    list: vi.fn(async () => [worktree]),
    get: vi.fn(async (id: string) => (id === worktree.id ? worktree : null)),
    create: vi.fn(async () => worktree),
    remove: vi.fn(async () => ({ removed: true as const })),
  };
  registerMainIpc(ipc, {
    projectService,
    coordinator,
    updater,
    projectActions,
    worktrees,
    appVersion: vi.fn(() => "1.0.0"),
    readRegistry: vi.fn(async () => ({ registry, source: "primary" as const, writable: true })),
    restoreRegistryBackup,
    chooseDirectory: vi.fn(async () => "C:\\Work"),
    getAvailability: vi.fn(async () => ({ vscode: true })),
    listAgents: vi.fn(async () => ({ agents: [] })),
    editAgents: vi.fn(async () => undefined),
    attentionState: vi.fn(() => ({ "session-1": "input" as const })),
    onSessionSelected: options.onSessionSelected,
  });
  return {
    handlers,
    projectService,
    coordinator,
    project,
    restoreRegistryBackup,
    updater,
    projectActions,
    calls,
    onSessionSelected: options.onSessionSelected,
  };
}

describe("main IPC boundary", () => {
  it("marks a selected terminal seen after persisting selection", async () => {
    const onSessionSelected = vi.fn();
    const { handlers } = setup({ onSessionSelected });

    await handlers.get("terminals:select")!({}, "project-1", "session-1");

    expect(onSessionSelected).toHaveBeenCalledWith("session-1");
  });

  it("answers the renderer's unread state request from the attention tracker", async () => {
    const { handlers } = setup();

    expect(await handlers.get("attention:state")!({})).toEqual({ "session-1": "input" });
  });

  it("persists the split pane and marks the split session seen", async () => {
    const onSessionSelected = vi.fn();
    const { handlers, coordinator } = setup({ onSessionSelected });

    await handlers.get("terminals:split")!({}, "session-2");

    expect(coordinator.split).toHaveBeenCalledWith("session-2");
    expect(onSessionSelected).toHaveBeenCalledWith("session-2");

    await handlers.get("terminals:split")!({}, null);
    expect(coordinator.split).toHaveBeenCalledWith(null);
  });

  it("uses the main-process folder chooser for manual project registration", async () => {
    const { handlers, projectService, project } = setup();

    const result = await handlers.get("projects:add-folder")!({});

    expect(projectService.registerManualFolder).toHaveBeenCalledWith("C:\\Work", "Work");
    expect(result).toEqual(project);
  });

  it("rejects renderer attempts to inject a terminal executable or cwd", async () => {
    const { handlers, coordinator } = setup();

    await expect(
      handlers.get("terminals:create")!({}, {
        projectId: "project-1",
        kind: "codex",
        cols: 80,
        rows: 24,
        executable: "cmd.exe",
      }),
    ).rejects.toThrow(/unknown fields/i);
    expect(coordinator.create).not.toHaveBeenCalled();
  });

  it("rejects unknown project metadata fields", async () => {
    const { handlers, projectService } = setup();

    await expect(
      handlers.get("projects:update")!({}, "project-1", { displayName: "Work", rootPath: "D:\\Injected" }),
    ).rejects.toThrow(/unknown fields/i);
    expect(projectService.updateProjectMetadata).not.toHaveBeenCalled();
  });

  it("accepts a tracks patch alongside the existing metadata fields", async () => {
    const { handlers, projectService } = setup();
    const tracks = [{ id: "track-1", title: "Launch", items: [{ id: "item-1", text: "Write tests", done: false }] }];

    await handlers.get("projects:update")!({}, "project-1", { memo: "notes", tracks });

    expect(projectService.updateProjectMetadata).toHaveBeenCalledWith("project-1", { memo: "notes", tracks });
  });

  it("annotates project snapshots with missing root ids without changing registry projects", async () => {
    const { handlers, projectService, project } = setup();

    const listed = await handlers.get("projects:list")!({});

    expect(listed).toMatchObject({ missingRootProjectIds: [project.id] });
    expect(projectService.findMissingProjectRoots).toHaveBeenCalledOnce();
    expect((listed as { registry: { projects: Record<string, unknown> } }).registry.projects[project.id]).not.toHaveProperty(
      "rootMissing",
    );
  });

  it("tears a folder's sessions down before unregistering the folder itself", async () => {
    const { handlers, coordinator, projectService, calls, project } = setup();

    const snapshot = await handlers.get("projects:remove")!({}, project.id);

    expect(coordinator.removeProjectSessions).toHaveBeenCalledWith(project.id);
    expect(projectService.removeProject).toHaveBeenCalledWith(project.id);
    expect(calls).toEqual(["removeProjectSessions", "removeProject"]);
    expect(snapshot).toMatchObject({ missingRootProjectIds: [project.id] });
  });

  it("leaves the folder registered when its sessions cannot be torn down", async () => {
    const { handlers, coordinator, projectService, project } = setup();
    coordinator.removeProjectSessions.mockRejectedValueOnce(new Error("pty is stuck"));

    await expect(handlers.get("projects:remove")!({}, project.id)).rejects.toThrow(/pty is stuck/);
    expect(projectService.removeProject).not.toHaveBeenCalled();
  });

  it("resolves folder actions from the registry so the renderer never supplies a path", async () => {
    const { handlers, projectActions, project } = setup();

    await handlers.get("projects:reveal")!({}, project.id);
    await handlers.get("projects:open-editor")!({}, project.id);
    await handlers.get("projects:open-github")!({}, project.id);
    const gitStatus = await handlers.get("projects:git-status")!({}, project.id);

    expect(projectActions.reveal).toHaveBeenCalledWith(project.rootPath);
    expect(projectActions.openInEditor).toHaveBeenCalledWith(project.rootPath);
    expect(projectActions.openOnGitHub).toHaveBeenCalledWith(project.rootPath);
    expect(projectActions.gitStatus).toHaveBeenCalledWith(project.rootPath);
    expect(gitStatus).toEqual({ isRepo: true, branch: "main", changedFileCount: 0 });
    await expect(handlers.get("projects:reveal")!({}, "unknown-project")).rejects.toThrow(/not found/i);
  });

  it("accepts a session name or a null that clears it, and rejects anything else", async () => {
    const { handlers, coordinator } = setup();

    await expect(handlers.get("terminals:rename")!({}, "session-1", { evil: true })).rejects.toThrow(/string or null/i);
    await expect(handlers.get("terminals:rename")!({}, "session-1", "x".repeat(121))).rejects.toThrow(/too long/i);
    expect(coordinator.rename).not.toHaveBeenCalled();

    await handlers.get("terminals:rename")!({}, "session-1", "레지스트리 분리");
    await handlers.get("terminals:rename")!({}, "session-1", null);

    expect(coordinator.rename).toHaveBeenNthCalledWith(1, "session-1", "레지스트리 분리");
    expect(coordinator.rename).toHaveBeenNthCalledWith(2, "session-1", null);
  });

  it("only accepts the maintenance commands the main process knows about", async () => {
    const { handlers, coordinator } = setup();

    await expect(
      handlers.get("terminals:create-tool")!({}, { tool: "rm -rf /", cols: 80, rows: 24 }),
    ).rejects.toThrow(/tool command is invalid/i);
    await expect(
      handlers.get("terminals:create-tool")!({}, { tool: "claude-update", cols: 80, rows: 24, command: "evil" }),
    ).rejects.toThrow(/unknown fields/i);
    expect(coordinator.createTool).not.toHaveBeenCalled();

    await handlers.get("terminals:create-tool")!({}, { tool: "codex-update", cols: 80, rows: 24 });
    expect(coordinator.createTool).toHaveBeenCalledWith({ tool: "codex-update", cols: 80, rows: 24 });
  });

  it("restores the registry backup and returns a fresh annotated snapshot", async () => {
    const { handlers, restoreRegistryBackup, project } = setup();

    const result = await handlers.get("projects:restore-backup")!({});

    expect(restoreRegistryBackup).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ missingRootProjectIds: [project.id], writable: true });
  });

  it("exposes the persisted selection through a read-only terminal state channel", async () => {
    const { handlers, coordinator, project } = setup();

    await expect(handlers.get("terminals:state")!({})).resolves.toMatchObject({
      state: { selectedProjectId: project.id, selectedSessionId: null },
    });
    expect(coordinator.state).toHaveBeenCalledOnce();
  });

  it("serves the current updater state so a late renderer does not miss the first check", async () => {
    const { handlers, updater } = setup();

    expect(handlers.get("app:version")!({})).toBe("1.0.0");
    expect(handlers.get("updater:status")!({})).toEqual({ state: "downloaded", version: "1.1.0" });
    expect(updater.status).toHaveBeenCalledOnce();
  });

  it("routes update checks, installs, and the manual releases fallback to the updater", async () => {
    const { handlers, updater } = setup();

    await handlers.get("updater:check")!({});
    await handlers.get("updater:install")!({});
    await handlers.get("app:open-releases")!({});
    await handlers.get("app:open-repository")!({});

    expect(updater.check).toHaveBeenCalledOnce();
    expect(updater.install).toHaveBeenCalledOnce();
    expect(updater.openReleases).toHaveBeenCalledOnce();
    expect(updater.openRepository).toHaveBeenCalledOnce();
  });
});
