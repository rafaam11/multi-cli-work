import {
  app,
  globalShortcut,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  net,
  Notification,
  powerMonitor,
  safeStorage,
  shell,
  utilityProcess,
} from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentDefinition } from "../shared/agent-types";
import type { AgentsSnapshot, ProviderAvailability } from "../shared/api-types";
import type { TerminalEvent } from "../shared/terminal-types";
import { notificationsMuted, type AppSettings, type AppSettingsPatch, type NotifiableStatus } from "../shared/settings-types";
import { agentsById, readAgentRegistry } from "./agents/agent-registry";
import { openAgentRegistryForEditing } from "./agents/agent-registry-file";
import { createRetryableDisposer } from "./runtime-disposal";
import { createSettingsService, type SettingsService } from "./settings/settings-store";
import { createNotionService } from "./notion/notion-service";
import { createNotionTokenStore } from "./notion/notion-token-store";
import {
  CONTROL_ENDPOINT_ENV,
  CONTROL_PIPE_ENV,
  resolveControlPipeName,
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
import { tagsOf } from "../shared/project-tags-types";
import {
  renderWorkProjectBrief,
  pruneSessionBriefs,
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
  changedPathsForRoot,
  createWorkspaceEntry,
  duplicateWorkspaceEntry,
  listWorkspaceDirectory,
  normalizeForCompare,
  openWorkspaceEntry,
  readWorkspaceFile,
  renameWorkspaceEntry,
  resolveTerminalPath,
  resolveWorkspaceEntryPath,
  resolveWorkspaceFilePath,
  trashWorkspaceEntry,
  withinRoot,
  writeWorkspaceFile,
} from "./projects/workspace-files";
import { WorktreeService } from "./projects/worktree-service";
import { ensureClaudeIntegration } from "./providers/claude-integration";
import { ensureCodexIntegration } from "./providers/codex-integration";
import { ensurePowerShellIntegration } from "./providers/powershell-integration";
import { SessionWorkspaceReader } from "./providers/session-workspace";
import { detectProviderExecutables, type ProviderExecutables } from "./providers/provider-launch";
import type { FileExplorerTarget } from "../shared/file-explorer-types";
import { startProviderStatusWatcher } from "./providers/provider-status";
import { SessionTitleReader } from "./providers/session-title";
import { AgentEditReader } from "./providers/agent-edits";
import type { AttentionSnapshot } from "./attention-policy";
import { createSessionAttentionController } from "./session-attention-controller";
import { isMainWindowSender, mainWindowState, sendToMainWindow } from "./main-window";
import { checkForUpdates, openReleasesPage, openRepositoryPage, updaterStatus } from "./updater";
import { discoverSessionEnvironment, prependPath } from "./platform-env";
import { TerminalCoordinator } from "./terminal/terminal-coordinator";
import {
  RestartingTerminalWorker,
  type RestartableTerminalWorkerTransport,
} from "./terminal/restarting-terminal-worker";
import { consumeRecoveryMarker, writeRecoveryMarkerSync } from "./state/recovery-marker";
import { createSummonShortcut } from "./summon-shortcut";
import { RemoteAccess } from "./remote/remote-access";
import { RemoteDeviceStore } from "./remote/device-store";
import { PairingCodes } from "./remote/pairing-codes";
import { RemoteSessionHub } from "./remote/remote-session-hub";
import { readShellArtifact } from "./remote/shell-artifact";
import { TerminalSizeArbiter } from "./remote/size-arbiter";
import { UNKNOWN_DEVICE_NAME, watchSizeOwners } from "./remote/size-owner-events";
import { tailscaleAddresses } from "./remote/tailscale-address";
import { buildRemoteCatalog, existingWorktrees } from "./remote/remote-catalog";
import { desktopPresence, PRESENCE_IDLE_THRESHOLD_SECONDS } from "./remote/desktop-presence";
import { assertNotReviewSession } from "./terminal/review-guard";
import { RemoteHostRegistry } from "./remote-client/host-registry";
import { pairWithHost } from "./remote-client/pair-host";
import { createRemoteHostsService } from "./remote-client/remote-hosts-service";
import { RemoteWindows } from "./remote-client/remote-windows";
import { HostStatusLink } from "./remote-client/host-status-link";
import { HostStatusLinks } from "./remote-client/host-status-links";
import { createStatusSocket } from "./remote-client/status-socket";
import { trayIconDataUrl } from "./tray-icon";
import { SessionIndicatorTracker } from "./terminal/session-indicators";
import { WorktreeScriptRunner } from "./projects/worktree-script-runner";
import { claudeUsageAllowed, fetchClaudeUsage, parseClaudeUsage, readClaudeCredentials } from "./usage/claude-usage";
import { readCodexUsage } from "./usage/codex-usage";
import { parseUsageSnapshot, UsageService, type ClaudeReading } from "./usage/usage-service";
import { readWorktreeScripts, removeWorktreeScripts, setWorktreeScripts } from "./projects/worktree-scripts";
import { aggregateTaskbarProgress, type TaskbarProgress } from "./window-progress";

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
  /** Saves a settings patch and tells every window — what the settings dialog does, for the tray. */
  updateSettings(patch: AppSettingsPatch): Promise<AppSettings>;
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
  const shellIntegrationPath = process.platform === "win32" ? await ensurePowerShellIntegration(userData) : undefined;
  const sessionWorkspaceReader = new SessionWorkspaceReader();
  const titleReader = new SessionTitleReader();
  const agentEditReader = new AgentEditReader();
  // "그 외 변경" (non-agent) highlighting compares a file's mtime against this. Defaults to app start
  // and is reset per-root to Date.now() by "변경 표시 지우기" (workspaceFiles.clearChanges below).
  const appStartMs = Date.now();
  const changeBaselines = new Map<string, number>();
  const changeBaselineFor = (rootPath: string): number =>
    changeBaselines.get(normalizeForCompare(path.resolve(rootPath), process.platform)) ?? appStartMs;
  // jk-coding-cli: the client lands in userData/bin (joined to every session's PATH below), the
  // token rotates per app run, and the pipe name can be overridden so a dev build next to an
  // installed one gets its own pipe instead of silently losing the CLI.
  const controlCli = await ensureControlCli(userData);
  const controlPipeName = resolveControlPipeName(process.env, userData);
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
    // 동기 캐시라 게터가 매번 최신 설정을 준다 — 설정 창에서 기본 구분을 바꾸면 다음 생성부터 반영된다.
    defaultCategory: () => settingsService.current().projects.defaultCategory,
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
    stopWorktreeSessions: (worktreeId) => coordinator.stopWorktreeSessions(worktreeId),
    removeWorktreeSessions: (worktreeId) => coordinator.removeWorktreeSessions(worktreeId),
    hasWorktreeSessions: (worktreeId) => coordinator.list().some((session) => session.worktreeId === worktreeId),
    runTeardown: (worktree, project) => worktreeScriptRunner.runTeardown(worktree, project),
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
    shellIntegrationPath,
    readWorkspace: (transcriptPath, since) => sessionWorkspaceReader.read(transcriptPath, since),
    resolveWorkspace: async (projectId, cwd) => worktrees.resolveSessionWorkspace(
      projectId, cwd, Object.values((await readProjectRegistry({ registryPath })).registry.projects),
    ),
    getExecutables,
    /**
     * 세션의 폴더가 무엇에 속하는지 두 갈래로 답하고 한 파일로 합친다: 업무 프로젝트(팀즈·노션·
     * 레포)와 ws-root 워크스페이스(프로젝트·형제 레포·데이터셋). 둘 중 하나만 있어도 브리프가
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
      const tags = workProject ? tagsOf(await readProjectTags(projectTagsOptions), workProject.id) : [];
      const workProjectSection = workProject
        ? renderWorkProjectBrief(
            workProject,
            workProject.members
              .map((member) => ({ project: registry.projects[member.projectId] ?? null, role: member.role }))
              .filter((member): member is WorkProjectBriefMember => member.project !== null),
            tags,
            // 팀즈 어휘를 쓸지는 이 설정 하나로 결정된다 — 없으면 브리프가 팀즈를 언급하지 않는다.
            { teamsSyncRoot: workProjectRegistry.teamsSyncRoot },
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
    readAgentEdits: (session, agent, transcriptPath) =>
      agentEditReader.refresh(
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
    indicators: (sessionId) => indicators.get(sessionId),
    setChip: (sessionId, chip) => indicators.setChip(sessionId, chip),
    clearChips: (sessionId, key) => indicators.clearChips(sessionId, key),
    setProgress: (sessionId, progress) => indicators.setProgress(sessionId, progress),
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
    getWindow: () => host.getMainWindow(),
    resolvePath: resolveWorkspaceFilePath,
  });

  // One snapshot feeds every surface: window frame + taskbar (via applyAttention) and the
  // renderer's sidebar badges (via the broadcast).
  const publishAttention = (snapshot: AttentionSnapshot) => {
    applyAttention(snapshot);
    sendToMainWindow(host.getMainWindow(), "attention:event", snapshot.unread);
  };
  const NOTIFICATION_BODY: Record<NotifiableStatus, string> = {
    "awaiting-input": "입력을 기다리는 중입니다",
    "awaiting-approval": "승인이 필요합니다",
    exited: "세션이 종료되었습니다",
    error: "세션이 오류로 중단되었습니다",
  };
  // 이 PC의 세션과, 등록해 둔 다른 PC의 세션이 같은 모양의 알림을 쓴다.
  const showStatusNotification = (title: string, status: NotifiableStatus, onClick: () => void) => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title, body: NOTIFICATION_BODY[status], silent: false });
    notification.on("click", onClick);
    notification.show();
  };
  const attention = createSessionAttentionController({
    readSelection: async () => {
      const { state } = await coordinator.state();
      return {
        selectedSessionId: state.selectedSessionId,
        visibleSessionIds: state.visibleSessionIds ?? [],
      };
    },
    windowState: () => mainWindowState(host.getMainWindow()),
    publish: publishAttention,
    notify(sessionId, status, onClick) {
      const session = coordinator.list().find((candidate) => candidate.id === sessionId);
      const title = session
        ? `${agentMap.get(session.kind)?.label ?? session.kind} · ${path.basename(session.cwd)}`
        : "멀티 터미널 작업기";
      showStatusNotification(title, status, onClick);
    },
    navigate(sessionId) {
      showMainWindow();
      sendToMainWindow(host.getMainWindow(), "navigation:session-requested", { sessionId });
    },
    logError: (message, error) => console.error(message, error),
    notificationSettings: () => settingsService.current().notifications,
  });

  // 모바일 컴패니언: 폰은 데스크톱 렌더러와 같은 코디네이터를 쓰는 두 번째 클라이언트다.
  // 설치본에 동봉된 셸 APK(resources/mobile). dev에서는 `npm run mobile:prepare`가 채우는 build/mobile.
  const shellDir =
    process.env.MULTI_CLI_WORK_SHELL_DIR ??
    (app.isPackaged ? path.join(process.resourcesPath, "mobile") : path.join(app.getAppPath(), "build", "mobile"));
  const shellArtifact = await readShellArtifact(shellDir);
  const sizes = new TerminalSizeArbiter((sessionId, cols, rows) => coordinator.resize(sessionId, cols, rows));
  const worktreeScriptsOptions = process.env.MULTI_CLI_WORK_WORKTREE_SCRIPTS_PATH
    ? { registryPath: process.env.MULTI_CLI_WORK_WORKTREE_SCRIPTS_PATH }
    : {};
  const worktreeScriptRunner = new WorktreeScriptRunner({
    platform: process.platform,
    scriptsDir: path.join(userData, "worktree-scripts"),
    readScripts: (projectId) => readWorktreeScripts(projectId, worktreeScriptsOptions),
    coordinator,
    shellExecutable: async () => (await getExecutables()).agents[process.platform === "win32" ? "powershell" : "bash"] ?? null,
  });
  // 패인 머리줄의 진행률·상태 칩. 터미널 출력(OSC 9;4)과 jk에서 오고, 세션과 함께 사라진다.
  const indicators = new SessionIndicatorTracker();
  let appliedTaskbarProgress = "";
  const applyTaskbarProgress = () => {
    const window = host.getMainWindow();
    if (!window || window.isDestroyed()) return;
    const progress: TaskbarProgress = settingsService.current().general.taskbarProgress
      ? aggregateTaskbarProgress(indicators.snapshot().flatMap(({ indicators: shown }) => (shown.progress ? [shown.progress] : [])))
      : { value: -1, mode: "none" };
    const key = `${progress.mode}:${progress.value}`;
    if (key === appliedTaskbarProgress) return;
    appliedTaskbarProgress = key;
    window.setProgressBar(progress.value, { mode: progress.mode });
  };
  indicators.onChange((update) => {
    sendToMainWindow(host.getMainWindow(), "terminals:indicators", update);
    applyTaskbarProgress();
  });
  const remoteDevices = new RemoteDeviceStore(path.join(userData, "remote-devices.json"));
  const remoteDeviceName = async (deviceId: string) =>
    (await remoteDevices.list()).find((device) => device.deviceId === deviceId)?.name ?? null;
  // 호스트 PC의 패인 머리줄이 "원격에서 크기 사용 중"을 보이게 한다.
  watchSizeOwners({
    sizes,
    deviceName: remoteDeviceName,
    send: (owner) => sendToMainWindow(host.getMainWindow(), "terminals:size-owner", owner),
  });
  const remoteHub = new RemoteSessionHub({
    gateway: {
      list: () => coordinator.list(),
      attach: (sessionId) => coordinator.attachForRenderer(sessionId),
      write: (sessionId, data) => coordinator.write(sessionId, data),
      onEvent: (listener) => coordinator.onEvent(listener),
      projectName: async (projectId) => (await getProject(projectId))?.displayName ?? null,
      worktreeBranch: async (worktreeId) => (await worktrees.get(worktreeId))?.branch ?? null,
      catalog: async () =>
        buildRemoteCatalog(
          Object.values((await readProjectRegistry({ registryPath })).registry.projects),
          (await listAgents()).agents,
          await existingWorktrees(await worktrees.list(), (target) => fs.access(target).then(() => true, () => false)),
        ),
      // 원격에서 띄우거나 되살린 세션은 이 PC 화면의 선택을 가져가지 않는다 — 제어 CLI의 spawn과 같다.
      create: (input) => coordinator.create(input, { updateSelection: false }),
      resume: (input) => coordinator.resume(input, { updateSelection: false }),
      stop: (sessionId) => coordinator.stop(sessionId),
      remove: async (sessionId) => {
        assertNotReviewSession(await github.activeReviews(), sessionId);
        await coordinator.remove(sessionId);
      },
      presence: () =>
        desktopPresence(
          mainWindowState(host.getMainWindow()),
          powerMonitor.getSystemIdleState(PRESENCE_IDLE_THRESHOLD_SECONDS),
        ),
    },
    devices: remoteDevices,
    sizes,
    hostId: () => remoteDevices.hostId(),
    hostName: os.hostname(),
    shellLatest: () => shellArtifact?.release ?? null,
  });
  const remoteAccess = new RemoteAccess({
    hub: remoteHub,
    devices: remoteDevices,
    pairing: new PairingCodes(),
    rendererDir: path.join(__dirname, "../renderer"),
    hostName: os.hostname(),
    bindOverride: process.env.MULTI_CLI_WORK_REMOTE_BIND ?? null,
    addresses: () => tailscaleAddresses(os.networkInterfaces()),
    shell: shellArtifact,
  });
  void remoteAccess.apply(settingsService.current().remote);

  // 이 PC가 클라이언트로서 다른 PC에 붙는 쪽. 위의 호스트 역할(remoteAccess)과는 독립이다.
  const remoteHostRegistry = new RemoteHostRegistry(path.join(userData, "remote-hosts.json"), safeStorage);
  const remoteWindows = new RemoteWindows({
    createWindow: (options) =>
      new BrowserWindow({ ...options, icon: nativeImage.createFromDataURL(trayIconDataUrl(32)) }),
    ipc: { on: (channel, listener) => ipcMain.on(channel, (event) => listener(event)) },
    preloadPath: path.join(__dirname, "../preload/remote-shell.js"),
    pairing: (hostId) => remoteHostRegistry.pairing(hostId),
    onUnpaired: (hostId) => remoteHosts.unpaired(hostId),
    showMainWindow,
  });
  // 원격 창을 닫아 둔 동안에도 그 PC의 세션이 사람을 기다리면 알 수 있게, 페어링된 호스트마다
  // 출력 없이 상태만 받는 연결을 하나씩 유지한다.
  const hostStatusLinks = new HostStatusLinks({
    createLink: (pairing, hooks) =>
      new HostStatusLink({
        host: pairing,
        createSocket: createStatusSocket,
        shouldNotify: (status) => {
          const notifications = settingsService.current().notifications;
          return (
            remoteHosts.notifyEnabled(pairing.hostId) &&
            notifications.desktop &&
            notifications.statuses[status] &&
            !notificationsMuted(notifications, new Date()) &&
            // 그 PC의 창을 보고 있는 중이면 눈앞의 화면이다.
            !remoteWindows.isFocused(pairing.hostId)
          );
        },
        notify: (notice) =>
          showStatusNotification(`${notice.hostName} · ${notice.label}`, notice.status, () => {
            void remoteWindows
              .open(notice.hostId, notice.sessionId)
              .catch((error) => console.error("Failed to open the remote window from a notification", error));
          }),
        ...hooks,
      }),
    onChange: () => {
      void remoteHosts.linkChanged().catch((error) => console.error("Failed to announce remote hosts", error));
    },
    onRejected: (hostId) => {
      void remoteHosts.unpaired(hostId).catch((error) => console.error("Failed to unpair a remote host", error));
    },
  });
  const remoteHosts = createRemoteHostsService({
    registry: remoteHostRegistry,
    windows: remoteWindows,
    links: hostStatusLinks,
    pair: (target, deviceName) => pairWithHost(target, deviceName),
    deviceName: os.hostname(),
    // 서버를 loopback에 띄우는 e2e·개발 실행에서만 loopback 호스트를 받는다.
    allowLoopback: Boolean(process.env.MULTI_CLI_WORK_REMOTE_BIND),
    announce: (hosts) => sendToMainWindow(host.getMainWindow(), "remote-hosts:changed", hosts),
  });
  void remoteHosts.start().catch((error) => console.error("Failed to link the paired remote hosts", error));

  // 트레이에 숨어 있어도 창을 불러오는 전역 단축키. 저장 전에 먼저 잡아 본다 — 다른 프로그램이 쥔
  // 키를 저장해 두면 눌러도 아무 일이 없는 설정이 남는다.
  const summonShortcut = createSummonShortcut(globalShortcut, showMainWindow);
  const savedSummon = settingsService.current().general.summonShortcut;
  if (savedSummon && !summonShortcut.apply(savedSummon)) {
    console.error(`Summon shortcut ${savedSummon} could not be registered; another program may hold it.`);
  }

  const updateSettings = async (patch: AppSettingsPatch): Promise<AppSettings> => {
    const wanted = patch.general?.summonShortcut;
    const previous = summonShortcut.current();
    if (wanted !== undefined && !summonShortcut.apply(wanted)) {
      throw new Error(`${wanted}는 다른 프로그램이 이미 쓰고 있어 등록할 수 없습니다`);
    }
    let next: AppSettings;
    try {
      next = await settingsService.update(patch);
    } catch (error) {
      if (wanted !== undefined) summonShortcut.apply(previous);
      throw error;
    }
    if (patch.remote) await remoteAccess.apply(next.remote);
    if (patch.general?.taskbarProgress !== undefined) applyTaskbarProgress();
    if (patch.usage?.enabled === true) void usageService.refresh(true);
    sendToMainWindow(host.getMainWindow(), "settings:changed", next);
    return next;
  };

  // 워크스페이스 동기화는 업무 프로젝트·태그 파일을 렌더러 모르게 바꾼다 — 바꾼 뒤엔 반드시 알린다.
  const announceWorkspaceChange = () => {
    sendToMainWindow(host.getMainWindow(), "workspace:changed");
  };

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
        announceWorkspaceChange();
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
        announceWorkspaceChange();
        return workspaceIndex.snapshot(await readWorkspaceRegistry(workspaceRegistryOptions));
      },
    },
    coordinator,
    notion: notionService,
    remote: {
      status: () => remoteAccess.status(),
      issuePairingCode: () => remoteAccess.issuePairingCode(),
      listDevices: () => remoteAccess.listDevices(),
      revokeDevice: (deviceId) => remoteAccess.revokeDevice(deviceId),
    },
    remoteHosts: {
      list: () => remoteHosts.list(),
      add: (input) => remoteHosts.add(input),
      remove: (hostId) => remoteHosts.remove(hostId),
      open: (hostId) => remoteHosts.open(hostId),
      setNotify: (hostId, notify) => remoteHosts.setNotify(hostId, notify),
    },
    indicators: { snapshot: () => indicators.snapshot() },
    usage: { state: () => usageService.snapshot(), refresh: () => usageService.refresh() },
    worktreeScripts: {
      get: (projectId) => readWorktreeScripts(projectId, worktreeScriptsOptions),
      set: (projectId, scripts) => setWorktreeScripts(projectId, scripts, worktreeScriptsOptions),
      forget: (projectId) => removeWorktreeScripts(projectId, worktreeScriptsOptions),
    },
    sizes: {
      desktopResize: (sessionId, cols, rows) => sizes.desktopResize(sessionId, cols, rows),
      desktopInput: (sessionId) => sizes.desktopInput(sessionId),
      deviceOwners: () =>
        Promise.all(
          sizes.deviceOwned().map(async ({ sessionId, deviceId }) => ({
            sessionId,
            deviceName: (await remoteDeviceName(deviceId)) ?? UNKNOWN_DEVICE_NAME,
          })),
        ),
    },
    settings: {
      get: () => settingsService.current(),
      update: (patch) => updateSettings(patch),
    },
    worktrees: {
      list: () => worktrees.list(),
      sync: (projects) => worktrees.sync(projects),
      get: (worktreeId) => worktrees.get(worktreeId),
      creationOptions: (projectId) => worktrees.creationOptions(projectId),
      previewPath: (projectId, branch) => worktrees.previewPath(projectId, branch),
      create: async (projectId, request) => {
        const worktree = await worktrees.create(projectId, request);
        const project = await getProject(projectId);
        // The worktree exists whatever happens here: a setup script that cannot start is reported,
        // not allowed to undo the creation.
        try {
          const setupSessionId = project ? await worktreeScriptRunner.runSetup(worktree, project) : null;
          return { worktree, setupSessionId, setupError: null };
        } catch (error) {
          return { worktree, setupSessionId: null, setupError: error instanceof Error ? error.message : String(error) };
        }
      },
      unlock: (worktreeId) => worktrees.unlock(worktreeId),
      cleanupStale: (projectId) => worktrees.cleanupStale(projectId),
      ownerForPath: (rootPath, projects) => worktrees.ownerForPath(rootPath, projects),
      remove: (worktreeId, force, options) => worktrees.remove(worktreeId, force, options),
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
      openEntry: (rootPath, relativePath, options) =>
        openWorkspaceEntry(rootPath, relativePath, options, async (target) => {
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
      openInEditor: async (rootPath, relativePath, position) =>
        projectActions.openInEditor(await resolveWorkspaceEntryPath(rootPath, relativePath), position),
      resolveTerminalPath: async (sessionId, raw) => {
        const view = coordinator.list().find((session) => session.id === sessionId);
        if (!view?.projectId) return null;
        const target: FileExplorerTarget = view.worktreeId
          ? { kind: "worktree", id: view.worktreeId }
          : { kind: "project", id: view.projectId };
        const rootPath = view.worktreeId
          ? (await worktrees.get(view.worktreeId))?.path
          : (await getProject(view.projectId))?.rootPath;
        if (!rootPath) return null;
        const relativePath = await resolveTerminalPath(rootPath, view.cwd, raw);
        return relativePath ? { target, relativePath } : null;
      },
      create: createWorkspaceEntry,
      rename: (rootPath, relativePath, name) => renameWorkspaceEntry(rootPath, relativePath, name),
      duplicate: duplicateWorkspaceEntry,
      trash: (rootPath, relativePath) =>
        trashWorkspaceEntry(rootPath, relativePath, (target) => shell.trashItem(target)),
      changedPaths: async (rootPath) =>
        changedPathsForRoot(rootPath, agentEditReader.entries(), changeBaselineFor(rootPath)),
      clearChanges: async (rootPath) => {
        const normalizedRoot = normalizeForCompare(path.resolve(rootPath), process.platform);
        agentEditReader.clear((absolutePath) =>
          withinRoot(normalizedRoot, normalizeForCompare(absolutePath, process.platform), process.platform),
        );
        changeBaselines.set(normalizedRoot, Date.now());
      },
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
      open: (viewId, rootPath, relativePath, bounds) => htmlPreviewController.open(viewId, rootPath, relativePath, bounds),
      setBounds: (viewId, bounds) => htmlPreviewController.setBounds(viewId, bounds),
      reload: (viewId) => htmlPreviewController.reload(viewId),
      close: (viewId) => htmlPreviewController.close(viewId),
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
      const window = host.getMainWindow();
      const options: Electron.OpenDialogOptions = {
        properties: ["openDirectory", "createDirectory"],
        ...(defaultPath ? { defaultPath } : {}),
      };
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    async saveTextFile(defaultName: string, text: string) {
      const window = host.getMainWindow();
      const options: Electron.SaveDialogOptions = {
        defaultPath: path.join(app.getPath("downloads"), defaultName),
        filters: [{ name: "텍스트", extensions: ["txt"] }],
      };
      const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;
      await fs.writeFile(result.filePath, text, "utf8");
      return result.filePath;
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
    isTrustedSender: (event) => isMainWindowSender(host.getMainWindow(), event),
  });

  // 등록에서 빠진 폴더의 세션 브리프는 다시 쓰일 일이 없다 — 시작할 때 한 번 치운다.
  void readProjectRegistry({ registryPath })
    .then(({ registry }) =>
      pruneSessionBriefs(path.join(userData, "project-briefs"), new Set(Object.keys(registry.projects))),
    )
    .catch((error) => console.error("Failed to prune session briefs", error));

  // 시작할 때 한 번 맞춰 둔다 — 사이드바가 처음 그려질 때 이미 채널·셸 묶음이 서 있도록.
  // 루트가 없으면 파일을 아예 건드리지 않으므로, 이 기능을 안 쓰는 사용자에게는 아무 일도 없다.
  void (async () => {
    if ((await readWorkspaceRegistry(workspaceRegistryOptions)).roots.length === 0) return;
    // 지난 실행 뒤에 배치가 옮겨졌을 수 있으므로 먼저 위치부터 맞춘다.
    await refreshRootLocations();
    const snapshot = await workspaceSnapshot();
    const { registry } = await readProjectRegistry({ registryPath });
    await workProjectService.syncFromWorkspace(snapshot, Object.values(registry.projects));
    // 첫 화면은 동기화 전에 그려졌을 수 있다 — 끝났으면 다시 읽게 한다.
    announceWorkspaceChange();
  })().catch((error) => console.error("Failed to sync work projects from the workspace", error));

  // 타이틀바의 구독 사용량. Claude는 로그인 토큰으로 사용량 API를, Codex는 자기 세션 기록을 읽는다.
  const usageSnapshotPath = path.join(userData, "usage-snapshot.json");
  const usageService = new UsageService({
    claude: async (): Promise<ClaudeReading> => {
      if (!claudeUsageAllowed(process.env)) return { kind: "unavailable" };
      const configDir = process.env.MULTI_CLI_WORK_CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR;
      const credentials = await readClaudeCredentials(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}, os.homedir());
      if (!credentials) return { kind: "unavailable" };
      // An expired token is Claude Code's to refresh; asking with it would only earn a 401.
      if (credentials.expiresAt !== null && credentials.expiresAt <= Date.now()) return { kind: "retry", afterMs: 5 * 60_000 };
      const response = await fetchClaudeUsage((url, init) => net.fetch(url, init), credentials.accessToken);
      if (response.status === 429) return { kind: "retry", afterMs: (response.retryAfterSec ?? 60) * 1_000 };
      if (response.status === 401 || response.status === 403) return { kind: "retry", afterMs: 5 * 60_000 };
      if (response.status !== 200) return { kind: "retry" };
      const usage = parseClaudeUsage(response.json, credentials.subscriptionType, new Date());
      return usage ? { kind: "ok", usage } : { kind: "unavailable" };
    },
    codex: () =>
      readCodexUsage(
        codexSessionsDirectory ?? path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions"),
        new Date(),
      ),
    hasLiveClaudeSession: () =>
      coordinator.list().some((session) => session.kind === "claude" && session.pid !== null && session.status !== "exited"),
    enabled: () => settingsService.current().usage.enabled,
    notifyEnabled: () => settingsService.current().usage.notifyAt90,
    notify: (provider, window) => {
      if (!Notification.isSupported()) return;
      const name = provider === "claude" ? "Claude" : "Codex";
      const span = window.kind === "5h" ? "5시간" : window.kind === "weekly" ? "주간" : "사용량";
      const reset = window.resetsAt ? ` · ${new Date(window.resetsAt).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" })} 초기화` : "";
      new Notification({ title: `${name} ${span} 한도 ${Math.round(window.usedPercent)}%`, body: `한도에 가까워졌습니다${reset}` }).show();
    },
    store: {
      read: async () => parseUsageSnapshot(await fs.readFile(usageSnapshotPath, "utf8")),
      write: (snapshot) => fs.writeFile(usageSnapshotPath, JSON.stringify(snapshot), "utf8"),
    },
  });
  usageService.onChange((snapshot) => sendToMainWindow(host.getMainWindow(), "usage:changed", snapshot));
  void usageService.start().catch((error) => console.error("Failed to start usage tracking", error));

  coordinator.onEvent((event: TerminalEvent) => {
    sendToMainWindow(host.getMainWindow(), "terminal:event", event);
    indicators.handle(event);
    if (event.type === "exit" || event.type === "removed") attention.clear(event.sessionId);
    if (event.type !== "status") return;
    void attention.handleStatus(event.sessionId, event.status).catch((error) =>
      console.error("Failed to update terminal attention", error),
    );
  });

  const dispose = createRetryableDisposer([
    () => void summonShortcut.apply(null),
    () => htmlPreviewController.dispose(),
    () => controlServer?.close(),
    () => hostStatusLinks.closeAll(),
    () => remoteWindows.closeAll(),
    () => remoteAccess.dispose(),
    () => statusWatcher.close(),
    () => usageService.stop(),
    () => coordinator.shutdown(),
    () => worker.dispose(),
  ]);

  return {
    coordinator,
    settings: settingsService,
    updateSettings,
    markVisibleSessionsSeen: () => attention.markVisibleSessionsSeen(),
    writeRecoveryMarker() {
      const activeIds = coordinator.list()
        .filter((session) => session.pid !== null && session.status !== "exited" && session.status !== "error")
        .map((session) => session.id);
      writeRecoveryMarkerSync(recoveryMarkerPath, activeIds);
    },
    dispose,
  };
}
