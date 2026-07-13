import { app, BrowserWindow, dialog, ipcMain, Notification, utilityProcess } from "electron";
import os from "node:os";
import path from "node:path";
import type { AgentDefinition } from "../shared/agent-types";
import type { AgentsSnapshot, ProviderAvailability } from "../shared/api-types";
import type { TerminalEvent } from "../shared/terminal-types";
import { agentsById, readAgentRegistry } from "./agents/agent-registry";
import { openAgentRegistryForEditing } from "./agents/agent-registry-file";
import { registerMainIpc } from "./ipc";
import { createProjectActions } from "./projects/project-actions";
import { ProjectService } from "./projects/project-service";
import { readProjectRegistry, restoreProjectRegistryFromBackup } from "./projects/project-registry";
import { ensureClaudeIntegration } from "./providers/claude-integration";
import { CodexSessionTracker } from "./providers/codex-session-tracker";
import { detectProviderExecutables, type ProviderExecutables } from "./providers/provider-launch";
import { startProviderStatusWatcher } from "./providers/provider-status";
import { readSessionTitle } from "./providers/session-title";
import { createTerminalAttentionTracker, type WindowAttention } from "./attention-policy";
import { createTerminalNotificationDeduper, shouldShowTerminalStatusNotification } from "./notification-policy";
import { checkForUpdates, openReleasesPage, openRepositoryPage, updaterStatus } from "./updater";
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
  applyAttention: (attention: WindowAttention) => void = () => undefined,
): Promise<DesktopRuntime> {
  const userData = app.getPath("userData");
  const registryPath = process.env.MULTI_CLI_WORK_REGISTRY_PATH;
  // Both transcript directories are only overridden so tests can point at a fixture.
  const claudeProjectsDirectory = process.env.MULTI_CLI_WORK_CLAUDE_PROJECTS_DIR;
  const codexSessionsDirectory = process.env.MULTI_CLI_WORK_CODEX_SESSIONS_DIR;
  const claudeIntegration = await ensureClaudeIntegration(userData);
  const projectService = new ProjectService({ registryPath });
  const agentRegistryPath = process.env.MULTI_CLI_WORK_AGENTS_PATH;
  const agentOptions = agentRegistryPath ? { registryPath: agentRegistryPath } : {};

  // `agents.json` is the user's to edit while the app runs, so the registry is re-read whenever the
  // renderer asks for the list rather than pinned at startup.
  let agentSnapshot = await readAgentRegistry(agentOptions);
  let agentMap = agentsById(agentSnapshot.agents);
  let executablePromise: Promise<ProviderExecutables> | null = null;
  const getExecutables = () => (executablePromise ??= detectProviderExecutables(agentSnapshot.agents));

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

  const worker = new RestartingTerminalWorker(
    () =>
      utilityProcess.fork(path.join(__dirname, "terminal-worker.js"), [], {
        serviceName: "Multi CLI Work PTY",
      }) as RestartableTerminalWorkerTransport,
  );
  const coordinator = new TerminalCoordinator({
    worker,
    statePath: path.join(userData, "state.json"),
    logDir: path.join(userData, "session-logs"),
    statusDir: claudeIntegration.statusDir,
    claudeSettingsPath: claudeIntegration.settingsPath,
    async getProject(projectId) {
      return (await readProjectRegistry({ registryPath })).registry.projects[projectId] ?? null;
    },
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
    env: {
      ...stringEnvironment(),
      MULTI_CLI_WORK_STATUS_DIR: claudeIntegration.statusDir,
    },
    idFactory: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
    codexSessions: new CodexSessionTracker({ sessionsDirectory: codexSessionsDirectory }),
  });
  await coordinator.initialize();

  const statusWatcher = await startProviderStatusWatcher(claudeIntegration.statusDir, (event) => {
    coordinator.applyProviderStatus(event.sessionId, event.status);
  });

  registerMainIpc(ipcMain, {
    projectService,
    coordinator,
    updater: {
      status: updaterStatus,
      check: checkForUpdates,
      install: installUpdate,
      openReleases: openReleasesPage,
      openRepository: openRepositoryPage,
    },
    projectActions: createProjectActions({ getExecutables }),
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
    onSessionSelected(sessionId) {
      applyAttention(attentionTracker.markSeen(sessionId));
    },
  });

  const notificationDeduper = createTerminalNotificationDeduper();
  const attentionTracker = createTerminalAttentionTracker();
  coordinator.onEvent((event: TerminalEvent) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("terminal:event", event);
    if (event.type === "exit") notificationDeduper.reset(event.sessionId);
    if (event.type !== "status") return;
    if (event.status !== "awaiting-input" && event.status !== "awaiting-approval") {
      applyAttention(attentionTracker.applyStatus(event.sessionId, event.status));
    }
    if (event.status === "working" || event.status === "exited" || event.status === "error") {
      notificationDeduper.reset(event.sessionId);
      return;
    }
    if (event.status !== "awaiting-input" && event.status !== "awaiting-approval") return;
    void (async () => {
      const windows = BrowserWindow.getAllWindows();
      let selectedSessionId: string | null = null;
      try {
        selectedSessionId = (await coordinator.state()).state.selectedSessionId;
      } catch (error) {
        console.error("Failed to read the selected terminal session", error);
      }
      const shouldShowNotification = shouldShowTerminalStatusNotification({
        eventSessionId: event.sessionId,
        selectedSessionId,
        windowVisible: windows.some((window) => window.isVisible()),
        windowFocused: windows.some((window) => window.isVisible() && window.isFocused()),
      });
      if (!shouldShowNotification) {
        notificationDeduper.reset(event.sessionId);
        applyAttention(attentionTracker.markSeen(event.sessionId));
        return;
      }
      applyAttention(attentionTracker.applyStatus(event.sessionId, event.status));
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
      statusWatcher.close();
      await coordinator.shutdown();
      worker.dispose();
    },
  };
}
