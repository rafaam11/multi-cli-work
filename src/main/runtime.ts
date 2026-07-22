import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, shell, utilityProcess } from "electron";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { AgentDefinition } from "../shared/agent-types";
import type { AgentsSnapshot, ProviderAvailability } from "../shared/api-types";
import type { TerminalEvent } from "../shared/terminal-types";
import { agentsById, readAgentRegistry } from "./agents/agent-registry";
import { openAgentRegistryForEditing } from "./agents/agent-registry-file";
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
import {
  listWorkspaceDirectory,
  readWorkspaceFile,
  resolveWorkspaceFilePath,
  runWorkspaceExecutable,
  writeWorkspaceFile,
} from "./projects/workspace-files";
import { pruneMissingWorktrees } from "./projects/worktree-registry";
import { WorktreeService } from "./projects/worktree-service";
import { ensureClaudeIntegration } from "./providers/claude-integration";
import { CodexSessionTracker } from "./providers/codex-session-tracker";
import { detectProviderExecutables, type ProviderExecutables } from "./providers/provider-launch";
import { startProviderStatusWatcher } from "./providers/provider-status";
import { readSessionTitle } from "./providers/session-title";
import { createTerminalAttentionTracker, type AttentionSnapshot } from "./attention-policy";
import { createTerminalNotificationDeduper, shouldShowTerminalStatusNotification } from "./notification-policy";
import { checkForUpdates, openReleasesPage, openRepositoryPage, updaterStatus } from "./updater";
import { discoverSessionEnvironment, prependPath } from "./platform-env";
import { TerminalCoordinator } from "./terminal/terminal-coordinator";
import {
  RestartingTerminalWorker,
  type RestartableTerminalWorkerTransport,
} from "./terminal/restarting-terminal-worker";

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
  dispose(): Promise<void>;
}

export async function createDesktopRuntime(
  showMainWindow: () => void,
  installUpdate: () => Promise<void>,
  applyAttention: (attention: AttentionSnapshot) => void = () => undefined,
): Promise<DesktopRuntime> {
  const userData = app.getPath("userData");
  const registryPath = process.env.MULTI_CLI_WORK_REGISTRY_PATH;
  // Both transcript directories are only overridden so tests can point at a fixture.
  const claudeProjectsDirectory = process.env.MULTI_CLI_WORK_CLAUDE_PROJECTS_DIR;
  const codexSessionsDirectory = process.env.MULTI_CLI_WORK_CODEX_SESSIONS_DIR;
  const claudeIntegration = await ensureClaudeIntegration(userData, process.platform);
  // jk-coding-cli: the client lands in userData/bin (joined to every session's PATH below), the
  // token rotates per app run, and the pipe name can be overridden so a dev build next to an
  // installed one gets its own pipe instead of silently losing the CLI.
  const controlCli = await ensureControlCli(userData);
  const controlPipeName = process.env[CONTROL_PIPE_ENV] ?? CONTROL_PIPE_NAME;
  const controlToken = crypto.randomUUID();
  const providerEnvironment = await discoverSessionEnvironment(stringEnvironment());
  const projectService = new ProjectService({ registryPath });
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
  // A worktree directory deleted outside the app (by hand, or `git worktree remove` on the CLI)
  // leaves an entry every action on which would fail — drop those before anything lists them.
  await pruneMissingWorktrees(
    new Date().toISOString(),
    worktreeRegistryPath ? { registryPath: worktreeRegistryPath } : {},
  ).catch((error) => console.error("Worktree pruning failed", error));
  // The service and the coordinator call each other (session teardown ↔ worktree cwd lookup);
  // the explicit annotations break the resulting inference cycle.
  const worktrees: WorktreeService = new WorktreeService({
    ...(worktreeRegistryPath ? { registryPath: worktreeRegistryPath } : {}),
    getProject,
    removeWorktreeSessions: (worktreeId) => coordinator.removeWorktreeSessions(worktreeId),
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
    statePath: path.join(userData, "state.json"),
    logDir: path.join(userData, "session-logs"),
    statusDir: claudeIntegration.statusDir,
    claudeSettingsPath: claudeIntegration.settingsPath,
    getProject,
    getWorktree: (worktreeId) => worktrees.get(worktreeId),
    getExecutables,
    getAgent: (agentId) => agentMap.get(agentId) ?? null,
    toolSessionCwd: () => os.homedir(),
    readTitle: (session, agent) =>
      readSessionTitle(
        {
          titleSource: agent.titleSource,
          cwd: session.cwd,
          providerConversationId: session.providerConversationId,
        },
        {
          ...(claudeProjectsDirectory ? { claudeProjectsDirectory } : {}),
          ...(codexSessionsDirectory ? { codexSessionsDirectory } : {}),
        },
      ),
    env: sessionEnvironment,
    idFactory: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    codexSessions: new CodexSessionTracker({ sessionsDirectory: codexSessionsDirectory }),
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

  const statusWatcher = await startProviderStatusWatcher(claudeIntegration.statusDir, (event) => {
    coordinator.applyProviderStatus(event.sessionId, event.status);
  });

  const projectActions = createProjectActions({ getExecutables });
  const htmlPreviewController = new HtmlPreviewController({
    view: new HtmlPreviewView(),
    getWindow: () => BrowserWindow.getAllWindows()[0] ?? null,
    resolvePath: resolveWorkspaceFilePath,
  });

  const attentionTracker = createTerminalAttentionTracker();
  // One snapshot feeds every surface: window frame + taskbar (via applyAttention) and the
  // renderer's sidebar badges (via the broadcast).
  const publishAttention = (snapshot: AttentionSnapshot) => {
    applyAttention(snapshot);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("attention:event", snapshot.unread);
    }
  };

  registerMainIpc(ipcMain, {
    projectService,
    coordinator,
    worktrees: {
      list: () => worktrees.list(),
      get: (worktreeId) => worktrees.get(worktreeId),
      create: (projectId, branch) => worktrees.create(projectId, branch),
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
    appVersion: () => app.getVersion(),
    readRegistry: () => readProjectRegistry({ registryPath }),
    async restoreRegistryBackup() {
      await restoreProjectRegistryFromBackup({ registryPath });
    },
    async chooseDirectory() {
      const window = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const result = window
        ? await dialog.showOpenDialog(window, { properties: ["openDirectory", "createDirectory"] })
        : await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    async getAvailability() {
      return availability(await getExecutables());
    },
    listAgents,
    editAgents: () => openAgentRegistryForEditing(agentRegistryPath),
    attentionState: () => attentionTracker.snapshot().unread,
    onSessionSelected(sessionId) {
      publishAttention(attentionTracker.markSeen(sessionId));
    },
  });

  const notificationDeduper = createTerminalNotificationDeduper();
  coordinator.onEvent((event: TerminalEvent) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("terminal:event", event);
    if (event.type === "exit") notificationDeduper.reset(event.sessionId);
    if (event.type !== "status") return;
    if (event.status !== "awaiting-input" && event.status !== "awaiting-approval") {
      publishAttention(attentionTracker.applyStatus(event.sessionId, event.status));
    }
    if (event.status === "working" || event.status === "exited" || event.status === "error") {
      notificationDeduper.reset(event.sessionId);
      return;
    }
    if (event.status !== "awaiting-input" && event.status !== "awaiting-approval") return;
    void (async () => {
      const windows = BrowserWindow.getAllWindows();
      let selectedSessionId: string | null = null;
      let splitSessionId: string | null = null;
      try {
        const { state } = await coordinator.state();
        selectedSessionId = state.selectedSessionId;
        splitSessionId = state.splitSessionId ?? null;
      } catch (error) {
        console.error("Failed to read the selected terminal session", error);
      }
      const shouldShowNotification = shouldShowTerminalStatusNotification({
        eventSessionId: event.sessionId,
        selectedSessionId,
        splitSessionId,
        windowVisible: windows.some((window) => window.isVisible()),
        windowFocused: windows.some((window) => window.isVisible() && window.isFocused()),
      });
      if (!shouldShowNotification) {
        notificationDeduper.reset(event.sessionId);
        publishAttention(attentionTracker.markSeen(event.sessionId));
        return;
      }
      publishAttention(attentionTracker.applyStatus(event.sessionId, event.status));
      if (!Notification.isSupported()) return;
      if (!notificationDeduper.shouldNotify(event.sessionId, event.status)) return;
      const session = coordinator.list().find((candidate) => candidate.id === event.sessionId);
      const title = session
        ? `${agentMap.get(session.kind)?.label ?? session.kind} · ${path.basename(session.cwd)}`
        : "멀티 터미널 작업기";
      const notification = new Notification({
        title,
        body: event.status === "awaiting-approval" ? "승인이 필요합니다" : "입력을 기다리는 중입니다",
        silent: false,
      });
      notification.on("click", showMainWindow);
      notification.show();
    })().catch((error) => console.error("Failed to show terminal notification", error));
  });

  return {
    coordinator,
    async dispose() {
      htmlPreviewController.dispose();
      controlServer?.close();
      statusWatcher.close();
      await coordinator.shutdown();
      worker.dispose();
    },
  };
}
