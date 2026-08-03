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
import { writeWorkProjectBrief, type WorkProjectBriefMember } from "./projects/work-project-brief";
import {
  listWorkspaceDirectory,
  readWorkspaceFile,
  resolveWorkspaceFilePath,
  runWorkspaceExecutable,
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
  markVisibleSessionsSeen(): Promise<void>;
  writeRecoveryMarker(): void;
  dispose(): Promise<void>;
}

export async function createDesktopRuntime(
  showMainWindow: () => void,
  installUpdate: () => Promise<void>,
  applyAttention: (attention: AttentionSnapshot) => void = () => undefined,
): Promise<DesktopRuntime> {
  const userData = app.getPath("userData");
  const statePath = path.join(userData, "state.json");
  const recoveryMarkerPath = path.join(userData, "shutdown-recovery.json");
  await consumeRecoveryMarker(recoveryMarkerPath, statePath);
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
  const workProjectService = new WorkProjectService({
    ...(workProjectRegistryPath ? { registryPath: workProjectRegistryPath } : {}),
  });
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
    // Resolves the folder's owning 업무 프로젝트 and writes its brief fresh for this launch.
    getWorkProjectBrief: async (projectId) => {
      const workProjectRegistry = await readWorkProjectRegistry({
        ...(workProjectRegistryPath ? { registryPath: workProjectRegistryPath } : {}),
      });
      const workProject = Object.values(workProjectRegistry.workProjects).find((candidate) =>
        candidate.members.some((member) => member.projectId === projectId),
      );
      if (!workProject) return null;
      const { registry } = await readProjectRegistry({ registryPath });
      const members = workProject.members
        .map((member) => ({ project: registry.projects[member.projectId] ?? null, role: member.role }))
        .filter((member): member is WorkProjectBriefMember => member.project !== null);
      return writeWorkProjectBrief(path.join(userData, "project-briefs"), workProject, members);
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
  const attention = createSessionAttentionController({
    readSelection: async () => {
      const { state } = await coordinator.state();
      return {
        selectedSessionId: state.selectedSessionId,
        splitSessionId: state.splitSessionId ?? null,
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
        body: status === "awaiting-approval" ? "승인이 필요합니다" : "입력을 기다리는 중입니다",
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
  });

  registerMainIpc(ipcMain, {
    projectService,
    workProjectService,
    readWorkProjectRegistry: () =>
      readWorkProjectRegistry({
        ...(workProjectRegistryPath ? { registryPath: workProjectRegistryPath } : {}),
      }),
    coordinator,
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
