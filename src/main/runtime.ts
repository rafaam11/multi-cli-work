import { app, BrowserWindow, dialog, ipcMain, Notification, utilityProcess } from "electron";
import os from "node:os";
import path from "node:path";
import type { ProviderAvailability } from "../shared/api-types";
import type { TerminalEvent } from "../shared/terminal-types";
import { registerMainIpc } from "./ipc";
import { createProjectActions } from "./projects/project-actions";
import { ProjectService } from "./projects/project-service";
import { readProjectRegistry, restoreProjectRegistryFromBackup } from "./projects/project-registry";
import { ensureClaudeIntegration } from "./providers/claude-integration";
import { CodexSessionTracker } from "./providers/codex-session-tracker";
import { detectProviderExecutables } from "./providers/provider-launch";
import { startProviderStatusWatcher } from "./providers/provider-status";
import { readSessionTitle } from "./providers/session-title";
import { createTerminalNotificationDeduper, shouldShowTerminalStatusNotification } from "./notification-policy";
import { checkForUpdates, openReleasesPage, updaterStatus } from "./updater";
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

function availability(executables: Awaited<ReturnType<typeof detectProviderExecutables>>): ProviderAvailability {
  return {
    powershell: executables.powershell !== null,
    claude: executables.claude !== null,
    codex: executables.codex !== null,
    vscode: executables.vscode !== null,
  };
}

export interface DesktopRuntime {
  coordinator: TerminalCoordinator;
  dispose(): Promise<void>;
}

export async function createDesktopRuntime(
  showMainWindow: () => void,
  installUpdate: () => Promise<void>,
): Promise<DesktopRuntime> {
  const userData = app.getPath("userData");
  const registryPath = process.env.MULTI_CLI_WORK_REGISTRY_PATH;
  // Both transcript directories are only overridden so tests can point at a fixture.
  const claudeProjectsDirectory = process.env.MULTI_CLI_WORK_CLAUDE_PROJECTS_DIR;
  const codexSessionsDirectory = process.env.MULTI_CLI_WORK_CODEX_SESSIONS_DIR;
  const claudeIntegration = await ensureClaudeIntegration(userData);
  const projectService = new ProjectService({ registryPath });

  const worker = new RestartingTerminalWorker(
    () =>
      utilityProcess.fork(path.join(__dirname, "terminal-worker.js"), [], {
        serviceName: "Multi CLI Work PTY",
      }) as RestartableTerminalWorkerTransport,
  );
  let executablePromise: ReturnType<typeof detectProviderExecutables> | null = null;
  const getExecutables = () => (executablePromise ??= detectProviderExecutables());
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
    toolSessionCwd: () => os.homedir(),
    readTitle: (session) =>
      readSessionTitle(session, {
        ...(claudeProjectsDirectory ? { claudeProjectsDirectory } : {}),
        ...(codexSessionsDirectory ? { codexSessionsDirectory } : {}),
      }),
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
  });

  const notificationDeduper = createTerminalNotificationDeduper();
  coordinator.onEvent((event: TerminalEvent) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("terminal:event", event);
    if (event.type === "exit") notificationDeduper.reset(event.sessionId);
    if (event.type !== "status") return;
    if (event.status === "working" || event.status === "exited" || event.status === "error") {
      notificationDeduper.reset(event.sessionId);
      return;
    }
    if (event.status !== "awaiting-input" && event.status !== "awaiting-approval") return;
    void (async () => {
      if (!Notification.isSupported()) return;
      const windows = BrowserWindow.getAllWindows();
      let selectedSessionId: string | null = null;
      try {
        selectedSessionId = (await coordinator.state()).state.selectedSessionId;
      } catch (error) {
        console.error("Failed to read the selected terminal session", error);
      }
      if (
        !shouldShowTerminalStatusNotification({
          eventSessionId: event.sessionId,
          selectedSessionId,
          windowVisible: windows.some((window) => window.isVisible()),
          windowFocused: windows.some((window) => window.isVisible() && window.isFocused()),
        })
      ) {
        notificationDeduper.reset(event.sessionId);
        return;
      }
      if (!notificationDeduper.shouldNotify(event.sessionId, event.status)) return;
      const session = coordinator.list().find((candidate) => candidate.id === event.sessionId);
      const title = session
        ? `${session.kind === "claude" ? "Claude" : "Codex"} · ${path.basename(session.cwd)}`
        : "Multi CLI Work";
      const notification = new Notification({
        title,
        body: event.status === "awaiting-approval" ? "Approval required" : "Waiting for input",
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
