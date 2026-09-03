import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  safeStorage,
  shell,
  utilityProcess,
} from "electron";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { AgentDefinition } from "../shared/agent-types";
import type { AgentsSnapshot, ProviderAvailability } from "../shared/api-types";
import type { TerminalEvent } from "../shared/terminal-types";
import type { NotifiableStatus } from "../shared/settings-types";
import { agentsById, readAgentRegistry } from "./agents/agent-registry";
import { openAgentRegistryForEditing } from "./agents/agent-registry-file";
import { createSettingsService, type SettingsService } from "./settings/settings-store";
import { createNotionService } from "./notion/notion-service";
import { createNotionTokenStore } from "./notion/notion-token-store";
import {
  CONTROL_ENDPOINT_ENV,
  CONTROL_PIPE_ENV,
  CONTROL_PIPE_NAME,
  CONTROL_TOKEN_ENV,
  ensureControlCli,
} from "./control/control-cli-installer";
import { handleControlCommand, type ControlCommandContext } from "./control/control-commands";
import { startControlServer } from "./control/control-server";
import { registerMainIpc } from "./ipc";
import { GitHubService } from "./github/github-service";
import { PullRequestReviewService } from "./github/review-service";
import {
  checkoutGitBranch,
  commitGitFiles,
  createGitBranch,
  fetchGitRemote,
  pullGitFastForward,
  pushCurrentBranch,
  readGitFileOriginal,
  readGitPanelData,
} from "./projects/git-commands";
import { createProjectActions } from "./projects/project-actions";
import {
  cherryPickGitCommit,
  createGitGraphBranch,
  createGitGraphTag,
  listGitGraph,
  readGitCommitDetails,
  readGitCommitFileDiff,
  revertGitCommit,
} from "./projects/git-graph";
import { HtmlPreviewController } from "./providers/html-preview-controller";
import { HtmlPreviewView } from "./providers/html-preview-view";
import { ProjectService } from "./projects/project-service";
import { readProjectRegistry, restoreProjectRegistryFromBackup } from "./projects/project-registry";
import { WorkProjectService } from "./projects/work-project-service";
import { readWorkProjectRegistry } from "./projects/work-project-registry";
import { readProjectTags, setProjectTags } from "./projects/project-tags-registry";
import {
  renderWorkProjectBrief,
  writeSessionBrief,
  type WorkProjectBriefMember,
} from "./projects/work-project-brief";
import { buildWorkspaceBrief } from "./projects/workspace-brief";
import { WorkspaceIndex, resolveWorkspaceRoots } from "./projects/workspace-index";
import {
  addWorkspaceRoot,
  readWorkspaceRegistry,
  removeWorkspaceRoot,
} from "./projects/workspace-registry";
import {
  createWorkspaceEntry,
  duplicateWorkspaceEntry,
  listWorkspaceDirectory,
  readWorkspaceFile,
  renameWorkspaceEntry,
  resolveWorkspaceEntryPath,
  resolveWorkspaceFilePath,
  runWorkspaceExecutable,
  trashWorkspaceEntry,
  writeWorkspaceFile,
} from "./projects/workspace-files";
import { WorktreeService } from "./projects/worktree-service";
import { ensureClaudeIntegration } from "./providers/claude-integration";
import { ensureCodexIntegration } from "./providers/codex-integration";
import { detectProviderExecutables, type ProviderExecutables } from "./providers/provider-launch";
import { startProviderStatusWatcher } from "./providers/provider-status";
import { SessionTitleReader } from "./providers/session-title";
import type { AttentionSnapshot } from "./attention-policy";
import { createSessionAttentionController } from "./session-attention-controller";
import { checkForUpdates, openReleasesPage, openRepositoryPage, updaterStatus } from "./updater";
import { discoverSessionEnvironment, prependPath } from "./platform-env";
import { TerminalCoordinator } from "./terminal/terminal-coordinator";
import {
  RestartingTerminalWorker,
  type RestartableTerminalWorkerTransport,
} from "./terminal/restarting-terminal-worker";
import { consumeRecoveryMarker, writeRecoveryMarkerSync } from "./state/recovery-marker";

function stringEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function availability(executables: ProviderExecutables): ProviderAvailability {
  return { vscode: executables.vscode !== null };
}

export interface DesktopRuntime {
  coordinator: TerminalCoordinator;
  settings: SettingsService;
  markVisibleSessionsSeen(): Promise<void>;
  writeRecoveryMarker(): void;
  dispose(): Promise<void>;
}

/** What the custom title bar needs from the app shell, which only `index.ts` owns. */
export interface DesktopWindowHost {
  /** Lazy, because the runtime is built before the window exists. */
  getMainWindow(): BrowserWindow | null;
  /** 파일▸종료: the confirm-then-tear-down path, not a bare `app.quit()`. */
  requestQuit(): Promise<void>;
}

/** Chrome's own zoom steps, so Ctrl+= feels the way it does in a browser or VS Code. */
const ZOOM_STEP = 0.5;
const ZOOM_LIMIT = 3;

export async function createDesktopRuntime(
  showMainWindow: () => void,
  installUpdate: () => Promise<void>,
  applyAttention: (attention: AttentionSnapshot) => void = () => undefined,
  host: DesktopWindowHost,
): Promise<DesktopRuntime> {
  const userData = app.getPath("userData");
  const statePath = path.join(userData, "state.json");
  const recoveryMarkerPath = path.join(userData, "shutdown-recovery.json");
  await consumeRecoveryMarker(recoveryMarkerPath, statePath);
  const settingsService = await createSettingsService(path.join(userData, "settings.json"));
  // 노션 통합 토큰은 시크릿이라 settings.json(평문)이 아니라 safeStorage로 암호화한 별도 파일에 둔다.
  const notionService = createNotionService(
    createNotionTokenStore(path.join(userData, "notion-credentials.json"), safeStorage),
  );
  const registryPath = process.env.MULTI_CLI_WORK_REGISTRY_PATH;
  // Both transcript directories are only overridden so tests can point at a fixture.
  const claudeProjectsDirectory = process.env.MULTI_CLI_WORK_CLAUDE_PROJECTS_DIR;
  const codexSessionsDirectory = process.env.MULTI_CLI_WORK_CODEX_SESSIONS_DIR;
  const claudeIntegration = await ensureClaudeIntegration(userData, process.platform);
  const codexIntegration = await ensureCodexIntegration({ userData });
  const titleReader = new SessionTitleReader();
  // jk-coding-cli: the client lands in userData/bin (joined to every session's PATH below), the
  // token rotates per app run, and the pipe name can be overridden so a dev build next to an
  // installed one gets its own pipe instead of silently losing the CLI.
  const controlCli = await ensureControlCli(userData);
  const controlPipeName = process.env[CONTROL_PIPE_ENV] ?? CONTROL_PIPE_NAME;
  const controlToken = crypto.randomUUID();
  const providerEnvironment = await discoverSessionEnvironment(stringEnvironment());
  const projectService = new ProjectService({ registryPath });
  // Like MULTI_CLI_WORK_REGISTRY_PATH: only overridden so tests can point at a fixture.
  const workProjectRegistryPath = process.env.MULTI_CLI_WORK_WORK_PROJECTS_PATH;
  const workspaceRegistryPath = process.env.MULTI_CLI_WORK_WORKSPACE_PATH;
  // Like MULTI_CLI_WORK_REGISTRY_PATH: only overridden so tests can point at a fixture.
  const projectTagsPath = process.env.MULTI_CLI_WORK_PROJECT_TAGS_PATH;
  const projectTagsOptions = projectTagsPath ? { registryPath: projectTagsPath } : {};
  const workProjectService = new WorkProjectService({
    ...(workProjectRegistryPath ? { registryPath: workProjectRegistryPath } : {}),
    ...(workspaceRegistryPath ? { workspaceRegistryPath } : {}),
    ...(projectTagsPath ? { projectTagsPath } : {}),
    platform: process.platform,
  });
  // ws-root 워크스페이스 루트. 등록된 루트가 없으면 이 기능 전체가 잠자코 있는다 — 아무것도
  // 스캔하지 않고, 업무 프로젝트도 만들지 않으며, 브리프에 워크스페이스 절이 붙지 않는다.
  const workspaceIndex = new WorkspaceIndex({ platform: process.platform });
  const workspaceRegistryOptions = workspaceRegistryPath ? { registryPath: workspaceRegistryPath } : {};
  const workspaceSnapshot = async () =>
    workspaceIndex.snapshot(await readWorkspaceRegistry(workspaceRegistryOptions));
  /**
   * 등록해 둔 dev·data 위치를 다시 찾는다. 워크스페이스 배치는 옮겨질 수 있고(형제 루트로의 이전
   * 같은), 그때 저장된 경로가 낡으면 레포가 자기 셸을 잃는다. 실제로 바뀐 루트만 다시 쓴다 —
   * 아무것도 안 바뀌었으면 파일에 손대지 않는다.
   */
  const refreshRootLocations = async () => {
    for (const root of (await readWorkspaceRegistry(workspaceRegistryOptions)).roots) {
      const siblings = await resolveWorkspaceRoots(root.work);
      if (siblings.dev === root.dev && siblings.data === root.data) continue;
      await addWorkspaceRoot(root.work, root.label, siblings, {
        ...workspaceRegistryOptions,
        platform: process.platform,
      });
      workspaceIndex.invalidate(root.work);
    }
  };
  const agentRegistryPath = process.env.MULTI_CLI_WORK_AGENTS_PATH;
  const agentOptions = { ...(agentRegistryPath ? { registryPath: agentRegistryPath } : {}), platform: process.platform };

  // `agents.json` is the user's to edit while the app runs, so the registry is re-read whenever the
  // renderer asks for the list rather than pinned at startup.
  let agentSnapshot = await readAgentRegistry(agentOptions);
  let agentMap = agentsById(agentSnapshot.agents);
  let executablePromise: Promise<ProviderExecutables> | null = null;
  const getExecutables = () =>
    (executablePromise ??= detectProviderExecutables(agentSnapshot.agents, process.platform, providerEnvironment));

  /** What a PATH lookup depends on. The renderer asks for the list on every window focus, and each
   *  lookup spawns `where.exe` per agent — so only an actual change to the agents is worth a rescan. */
  const executableKey = (agents: readonly AgentDefinition[]): string =>
    agents.map((agent) => `${agent.id}:${agent.commands.join(",")}`).join("|");

  async function listAgents(): Promise<AgentsSnapshot> {
    const previousKey = executableKey(agentSnapshot.agents);
    agentSnapshot = await readAgentRegistry(agentOptions);
    agentMap = agentsById(agentSnapshot.agents);
    if (executableKey(agentSnapshot.agents) !== previousKey) executablePromise = null;
    const executables = await getExecutables();
    return {
      agents: agentSnapshot.agents.map((agent) => ({ ...agent, available: executables.agents[agent.id] !== null })),
      ...(agentSnapshot.warning !== undefined ? { warning: agentSnapshot.warning } : {}),
    };
  }

  const getProject = async (projectId: string) =>
    (await readProjectRegistry({ registryPath })).registry.projects[projectId] ?? null;

  const worktreeRegistryPath = process.env.MULTI_CLI_WORK_WORKTREES_PATH;
  // The service and the coordinator call each other (session teardown ↔ worktree cwd lookup);
  // the explicit annotations break the resulting inference cycle.
  const worktrees: WorktreeService = new WorktreeService({
    ...(worktreeRegistryPath ? { registryPath: worktreeRegistryPath } : {}),
    getProject,
    removeWorktreeSessions: (worktreeId) => coordinator.removeWorktreeSessions(worktreeId),
    hasWorktreeSessions: (worktreeId) => coordinator.list().some((session) => session.worktreeId === worktreeId),
    idFactory: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  });

  const worker = new RestartingTerminalWorker(
    () =>
      utilityProcess.fork(path.join(__dirname, "terminal-worker.js"), [], {
        serviceName: "Multi CLI Work PTY",
      }) as RestartableTerminalWorkerTransport,
  );
  const sessionEnvironment = prependPath(
    {
      ...providerEnvironment,
      MULTI_CLI_WORK_STATUS_DIR: claudeIntegration.statusDir,
      [CONTROL_PIPE_ENV]: controlPipeName,
      [CONTROL_TOKEN_ENV]: controlToken,
    },
    controlCli.binDir,
  );
  const coordinator: TerminalCoordinator = new TerminalCoordinator({
    worker,
    statePath,
    logDir: path.join(userData, "session-logs"),
    statusDir: claudeIntegration.statusDir,
    claudeSettingsPath: claudeIntegration.settingsPath,
    getProject,
    getWorktree: (worktreeId) => worktrees.get(worktreeId),
    getExecutables,
    /**
     * 세션의 폴더가 무엇에 속하는지 두 갈래로 답하고 한 파일로 합친다: 업무 프로젝트(팀즈·노션·
     * 레포)와 ws-root 워크스페이스(채널·셸·형제 레포·데이터셋). 둘 중 하나만 있어도 브리프가
     * 나가고, 둘 다 없으면 null이라 세션은 브리프 없이 평소대로 열린다.
     *
     * 파일 이름은 업무 프로젝트가 아니라 **폴더** 기준이다 — 같은 업무 프로젝트의 두 폴더도
     * 워크스페이스 절(형제 레포·데이터셋)이 다르기 때문.
     */
    getWorkProjectBrief: async (projectId) => {
      const { registry } = await readProjectRegistry({ registryPath });
      const workProjectRegistry = await readWorkProjectRegistry({
        ...(workProjectRegistryPath ? { registryPath: workProjectRegistryPath } : {}),
      });
      const workProject = Object.values(workProjectRegistry.workProjects).find((candidate) =>
        candidate.members.some((member) => member.projectId === projectId),
      );
      const workProjectSection = workProject
        ? renderWorkProjectBrief(
            workProject,
            workProject.members
              .map((member) => ({ project: registry.projects[member.projectId] ?? null, role: member.role }))
              .filter((member): member is WorkProjectBriefMember => member.project !== null),
          )
        : null;
      const project = registry.projects[projectId] ?? null;
      const workspaceRegistry = await readWorkspaceRegistry(workspaceRegistryOptions);
      const workspaceSection =
        project && workspaceRegistry.roots.length > 0
          ? await buildWorkspaceBrief(
              project.rootPath,
              await workspaceIndex.snapshot(workspaceRegistry),
              process.platform,
            )
          : null;
      return writeSessionBrief(path.join(userData, "project-briefs"), projectId, [
        workProjectSection,
        workspaceSection,
      ]);
    },
    getAgent: (agentId) => agentMap.get(agentId) ?? null,
    toolSessionCwd: () => os.homedir(),
    codexProfileName: codexIntegration.profileName,
    readTitle: (session, agent, transcriptPath) =>
      titleReader.read(
        {
          titleSource: agent.titleSource,
          cwd: session.cwd,
          providerConversationId: session.providerConversationId,
          ...(transcriptPath ? { transcriptPath } : {}),
        },
        {
          ...(claudeProjectsDirectory ? { claudeProjectsDirectory } : {}),
          ...(codexSessionsDirectory ? { codexSessionsDirectory } : {}),
        },
      ),
    env: sessionEnvironment,
    idFactory: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    autoResumeEnabled: () => settingsService.current().general.autoResumeSessions,
  });
  const controlContext: ControlCommandContext = {
    sessions: () => coordinator.list(),
    write: (sessionId, data) => coordinator.write(sessionId, data),
    readReplay: async (sessionId) => (await coordinator.attach(sessionId)).replay,
    create: (input) => coordinator.create(input, { updateSelection: false }),
    onEvent: (listener) => coordinator.onEvent(listener),
    projectName: async (projectId) => (await getProject(projectId))?.displayName ?? null,
  };
  const controlServer = await startControlServer({
    pipeName: controlPipeName,
    token: controlToken,
    handle: (request) => handleControlCommand(request, controlContext),
    log: (message, error) => console.error(message, error),
  });
  if (controlServer) sessionEnvironment[CONTROL_ENDPOINT_ENV] = controlServer.endpoint;
  await coordinator.initialize();

  const reviewRegistryPath = process.env.MULTI_CLI_WORK_PR_REVIEWS_PATH;
  const reviewService = new PullRequestReviewService({
    ...(reviewRegistryPath ? { registryPath: reviewRegistryPath } : {}),
    ...(worktreeRegistryPath ? { worktreeRegistryPath } : {}),
    getProject,
    createSession: (input) => coordinator.create(input, { updateSelection: true }),
    attachSession: (sessionId) => coordinator.attachForRenderer(sessionId),
    writeSession: (sessionId, data) => coordinator.write(sessionId, data),
    removeSession: (sessionId) => coordinator.remove(sessionId),
    listSessions: () => coordinator.list(),
    removeWorktree: (worktreeId, force) => worktrees.remove(worktreeId, force),
    idFactory: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  });
  const github = new GitHubService({
    getProject,
    reviews: reviewService,
    createAuthSession: async (projectId, host) => {
      const kind = process.platform === "win32" ? "powershell" : "bash";
      const session = await coordinator.create({ projectId, kind, cols: 120, rows: 36 });
      await coordinator.attachForRenderer(session.id);
      await coordinator.write(session.id, `gh auth login --hostname ${host}\r`);
      return session;
    },
  });

  const statusWatcher = await startProviderStatusWatcher(claudeIntegration.statusDir, (event) => {
    coordinator.applyProviderStatus(event);
  });

  const projectActions = createProjectActions({ getExecutables });
  const htmlPreviewController = new HtmlPreviewController({
    view: new HtmlPreviewView(),
    getWindow: () => BrowserWindow.getAllWindows()[0] ?? null,
    resolvePath: resolveWorkspaceFilePath,
  });

  // One snapshot feeds every surface: window frame + taskbar (via applyAttention) and the
  // renderer's sidebar badges (via the broadcast).
  const publishAttention = (snapshot: AttentionSnapshot) => {
    applyAttention(snapshot);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("attention:event", snapshot.unread);
    }
  };
  const NOTIFICATION_BODY: Record<NotifiableStatus, string> = {
    "awaiting-input": "입력을 기다리는 중입니다",
    "awaiting-approval": "승인이 필요합니다",
    exited: "세션이 종료되었습니다",
    error: "세션이 오류로 중단되었습니다",
  };
  const attention = createSessionAttentionController({
    readSelection: async () => {
      const { state } = await coordinator.state();
      return {
        selectedSessionId: state.selectedSessionId,
        visibleSessionIds: state.visibleSessionIds ?? [],
      };
    },
    windowState: () => {
      const windows = BrowserWindow.getAllWindows();
      return {
        visible: windows.some((window) => window.isVisible()),
        focused: windows.some((window) => window.isVisible() && window.isFocused()),
      };
    },
    publish: publishAttention,
    notify(sessionId, status, onClick) {
      if (!Notification.isSupported()) return;
      const session = coordinator.list().find((candidate) => candidate.id === sessionId);
      const title = session
        ? `${agentMap.get(session.kind)?.label ?? session.kind} · ${path.basename(session.cwd)}`
        : "멀티 터미널 작업기";
      const notification = new Notification({
        title,
        body: NOTIFICATION_BODY[status],
        silent: false,
      });
      notification.on("click", onClick);
      notification.show();
    },
    navigate(sessionId) {
      showMainWindow();
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send("navigation:session-requested", { sessionId });
      }
    },
    logError: (message, error) => console.error(message, error),
    notificationSettings: () => settingsService.current().notifications,
  });

  registerMainIpc(ipcMain, {
    projectService,
    workProjectService,
    readWorkProjectRegistry: () =>
      readWorkProjectRegistry({
        ...(workProjectRegistryPath ? { registryPath: workProjectRegistryPath } : {}),
      }),
    projectTags: {
      list: () => readProjectTags(projectTagsOptions),
      set: (workProjectId, tags) => setProjectTags(workProjectId, tags, projectTagsOptions),
    },
    workspace: {
      snapshot: workspaceSnapshot,
      async addRoot(rootPath: string) {
        // dev·data 루트는 이 PC에서 찾아 적어 둔다 — 배치가 옮겨지는 중이라 관례만 믿을 수 없다.
        const siblings = await resolveWorkspaceRoots(rootPath);
        // 루트가 바뀌면 다음 조회는 반드시 다시 훑는다 — 캐시는 mtime만 보므로 새 루트를 모른다.
        const registry = await addWorkspaceRoot(rootPath, null, siblings, {
          ...workspaceRegistryOptions,
          platform: process.platform,
        });
        workspaceIndex.invalidate();
        return workspaceIndex.snapshot(registry);
      },
      async removeRoot(rootPath: string) {
        const registry = await removeWorkspaceRoot(rootPath, {
          ...workspaceRegistryOptions,
          platform: process.platform,
        });
        workspaceIndex.invalidate(rootPath);
        return workspaceIndex.snapshot(registry);
      },
      async sync() {
        workspaceIndex.invalidate();
        await refreshRootLocations();
        const snapshot = await workspaceSnapshot();
        const { registry } = await readProjectRegistry({ registryPath });
        // 등록된 루트가 없으면 아무것도 쓰지 않는다.
        if (snapshot.registry.roots.length === 0) return snapshot;
        await workProjectService.syncFromWorkspace(snapshot, Object.values(registry.projects));
        return workspaceIndex.snapshot(await readWorkspaceRegistry(workspaceRegistryOptions));
      },
    },
    coordinator,
    notion: notionService,
    settings: {
      get: () => settingsService.current(),
      update: async (patch) => {
        const next = await settingsService.update(patch);
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send("settings:changed", next);
        }
        return next;
      },
    },
    worktrees: {
      list: () => worktrees.list(),
      sync: (projects) => worktrees.sync(projects),
      get: (worktreeId) => worktrees.get(worktreeId),
      creationOptions: (projectId) => worktrees.creationOptions(projectId),
      previewPath: (projectId, branch) => worktrees.previewPath(projectId, branch),
      create: (projectId, request) => worktrees.create(projectId, request),
      unlock: (worktreeId) => worktrees.unlock(worktreeId),
      cleanupStale: (projectId) => worktrees.cleanupStale(projectId),
      ownerForPath: (rootPath, projects) => worktrees.ownerForPath(rootPath, projects),
      remove: (worktreeId, force) => worktrees.remove(worktreeId, force),
    },
    updater: {
      status: updaterStatus,
      check: checkForUpdates,
      install: installUpdate,
      openReleases: openReleasesPage,
      openRepository: openRepositoryPage,
    },
    projectActions,
    workspaceFiles: {
      listDirectory: listWorkspaceDirectory,
      readFile: readWorkspaceFile,
      writeFile: writeWorkspaceFile,
      runExecutable: (rootPath, relativePath) =>
        runWorkspaceExecutable(rootPath, relativePath, async (target) => {
          if (process.platform === "win32") return shell.openPath(target);
          await new Promise<void>((resolve, reject) => {
            const child = spawn(target, [], {
              cwd: path.dirname(target),
              detached: true,
              stdio: "ignore",
              shell: false,
            });
            child.once("error", reject);
            child.once("spawn", () => {
              child.unref();
              resolve();
            });
          });
        }),
      absolutePath: resolveWorkspaceEntryPath,
      reveal: async (rootPath, relativePath) => {
        // showItemInFolder selects the entry rather than opening it, which is what the menu says.
        shell.showItemInFolder(await resolveWorkspaceEntryPath(rootPath, relativePath));
      },
      openInEditor: async (rootPath, relativePath) =>
        projectActions.openInEditor(await resolveWorkspaceEntryPath(rootPath, relativePath)),
      create: createWorkspaceEntry,
      rename: (rootPath, relativePath, name) => renameWorkspaceEntry(rootPath, relativePath, name),
      duplicate: duplicateWorkspaceEntry,
      trash: (rootPath, relativePath) =>
        trashWorkspaceEntry(rootPath, relativePath, (target) => shell.trashItem(target)),
    },
    git: {
      panelData: readGitPanelData,
      checkout: checkoutGitBranch,
      createBranch: createGitBranch,
      commit: commitGitFiles,
      push: pushCurrentBranch,
      fetch: fetchGitRemote,
      pull: pullGitFastForward,
      fileOriginal: readGitFileOriginal,
    },
    github,
    gitGraph: {
      list: listGitGraph,
      commitDetails: readGitCommitDetails,
      fileDiff: readGitCommitFileDiff,
      createBranch: createGitGraphBranch,
      createTag: createGitGraphTag,
      cherryPick: cherryPickGitCommit,
      revert: revertGitCommit,
    },
    htmlPreview: {
      open: (rootPath, relativePath, bounds) => htmlPreviewController.open(rootPath, relativePath, bounds),
      setBounds: (bounds) => htmlPreviewController.setBounds(bounds),
      reload: () => htmlPreviewController.reload(),
      close: () => htmlPreviewController.close(),
    },
    shell: {
      openExternal: (url) => shell.openExternal(url),
    },
    clipboard,
    windowControls: {
      minimize: () => host.getMainWindow()?.minimize(),
      toggleMaximize: () => {
        const window = host.getMainWindow();
        if (!window) return;
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
      },
      // ✕ keeps the app's existing meaning: the window's own close handler hides it to the tray.
      close: () => host.getMainWindow()?.close(),
      state: () => {
        const window = host.getMainWindow();
        return { maximized: window?.isMaximized() ?? false, fullScreen: window?.isFullScreen() ?? false };
      },
      toggleFullScreen: () => {
        const window = host.getMainWindow();
        if (!window) return;
        window.setFullScreen(!window.isFullScreen());
      },
      toggleDevTools: () => host.getMainWindow()?.webContents.toggleDevTools(),
      reload: () => host.getMainWindow()?.webContents.reload(),
      // The renderer is sandboxed and cannot set its own zoom, so the menu routes it here.
      zoom: (action) => {
        const contents = host.getMainWindow()?.webContents;
        if (!contents) return;
        const next = action === "reset" ? 0 : contents.getZoomLevel() + (action === "in" ? ZOOM_STEP : -ZOOM_STEP);
        contents.setZoomLevel(Math.min(ZOOM_LIMIT, Math.max(-ZOOM_LIMIT, next)));
      },
      quit: () => host.requestQuit(),
    },
    appVersion: () => app.getVersion(),
    readRegistry: () => readProjectRegistry({ registryPath }),
    async restoreRegistryBackup() {
      await restoreProjectRegistryFromBackup({ registryPath });
    },
    async chooseDirectory(defaultPath?: string) {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options: Electron.OpenDialogOptions = {
        properties: ["openDirectory", "createDirectory"],
        ...(defaultPath ? { defaultPath } : {}),
      };
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    async getAvailability() {
      return availability(await getExecutables());
    },
    listAgents,
    editAgents: () => openAgentRegistryForEditing(agentRegistryPath),
    attentionState: () => attention.snapshot().unread,
    onSessionSelected(sessionId) {
      attention.markSeen(sessionId);
    },
  });

  // 시작할 때 한 번 맞춰 둔다 — 사이드바가 처음 그려질 때 이미 채널·셸 묶음이 서 있도록.
  // 루트가 없으면 파일을 아예 건드리지 않으므로, 이 기능을 안 쓰는 사용자에게는 아무 일도 없다.
  void (async () => {
    if ((await readWorkspaceRegistry(workspaceRegistryOptions)).roots.length === 0) return;
    // 지난 실행 뒤에 배치가 옮겨졌을 수 있으므로 먼저 위치부터 맞춘다.
    await refreshRootLocations();
    const snapshot = await workspaceSnapshot();
    const { registry } = await readProjectRegistry({ registryPath });
    await workProjectService.syncFromWorkspace(snapshot, Object.values(registry.projects));
  })().catch((error) => console.error("Failed to sync work projects from the workspace", error));

  coordinator.onEvent((event: TerminalEvent) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("terminal:event", event);
    if (event.type === "exit") attention.clear(event.sessionId);
    if (event.type !== "status") return;
    void attention.handleStatus(event.sessionId, event.status).catch((error) =>
      console.error("Failed to update terminal attention", error),
    );
  });

  return {
    coordinator,
    settings: settingsService,
    markVisibleSessionsSeen: () => attention.markVisibleSessionsSeen(),
    writeRecoveryMarker() {
      const activeIds = coordinator.list()
        .filter((session) => session.pid !== null && session.status !== "exited" && session.status !== "error")
        .map((session) => session.id);
      writeRecoveryMarkerSync(recoveryMarkerPath, activeIds);
    },
    async dispose() {
      htmlPreviewController.dispose();
      controlServer?.close();
      statusWatcher.close();
      await coordinator.shutdown();
      worker.dispose();
    },
  };
}
