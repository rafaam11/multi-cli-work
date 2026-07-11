import { app, BrowserWindow, dialog, ipcMain, Notification, utilityProcess } from "electron";
import path from "node:path";
import type { ProviderAvailability } from "../shared/api-types";
import type { TerminalWorkerEvent } from "../shared/terminal-types";
import { registerMainIpc } from "./ipc";
import { ProjectService } from "./projects/project-service";
import { readProjectRegistry } from "./projects/project-registry";
import { ensureClaudeIntegration } from "./providers/claude-integration";
import { CodexSessionTracker } from "./providers/codex-session-tracker";
import { detectProviderExecutables } from "./providers/provider-launch";
import { startProviderStatusWatcher } from "./providers/provider-status";
import { TerminalCoordinator } from "./terminal/terminal-coordinator";
import { TerminalWorkerClient } from "./terminal/terminal-worker-client";

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
  };
}

export interface DesktopRuntime {
  coordinator: TerminalCoordinator;
  dispose(): Promise<void>;
}

export async function createDesktopRuntime(showMainWindow: () => void): Promise<DesktopRuntime> {
  const userData = app.getPath("userData");
  const claudeIntegration = await ensureClaudeIntegration(userData);
  const projectService = new ProjectService();
  await projectService.discoverAndReconcile().catch((error) => {
    console.error("Project discovery failed", error);
  });

  const worker = utilityProcess.fork(path.join(__dirname, "terminal-worker.js"), [], {
    serviceName: "Multi CLI Work PTY",
  });
  const workerClient = new TerminalWorkerClient(worker);
  let executablePromise: ReturnType<typeof detectProviderExecutables> | null = null;
  const getExecutables = () => (executablePromise ??= detectProviderExecutables());
  const coordinator = new TerminalCoordinator({
    worker: workerClient,
    statePath: path.join(userData, "state.json"),
    logDir: path.join(userData, "session-logs"),
    claudeSettingsPath: claudeIntegration.settingsPath,
    async getProject(projectId) {
      return (await readProjectRegistry()).registry.projects[projectId] ?? null;
    },
    getExecutables,
    env: {
      ...stringEnvironment(),
      MULTI_CLI_WORK_STATUS_DIR: claudeIntegration.statusDir,
    },
    idFactory: crypto.randomUUID,
    now: () => new Date().toISOString(),
    codexSessions: new CodexSessionTracker(),
  });
  await coordinator.initialize();

  const statusWatcher = await startProviderStatusWatcher(claudeIntegration.statusDir, (event) => {
    coordinator.applyProviderStatus(event.sessionId, event.status);
  });

  registerMainIpc(ipcMain, {
    projectService,
    coordinator,
    readRegistry: () => readProjectRegistry(),
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

  coordinator.onEvent((event: TerminalWorkerEvent) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send("terminal:event", event);
    if (event.type !== "status" || (event.status !== "awaiting-input" && event.status !== "awaiting-approval")) return;
    const window = BrowserWindow.getAllWindows()[0];
    if (window?.isFocused() || !Notification.isSupported()) return;
    const session = coordinator.list().find((candidate) => candidate.id === event.sessionId);
    const title = session ? `${session.kind === "claude" ? "Claude" : "Codex"} · ${path.basename(session.cwd)}` : "Multi CLI Work";
    const notification = new Notification({
      title,
      body: event.status === "awaiting-approval" ? "Approval required" : "Waiting for input",
      silent: false,
    });
    notification.on("click", showMainWindow);
    notification.show();
  });

  return {
    coordinator,
    async dispose() {
      statusWatcher.close();
      await coordinator.shutdown();
      worker.kill();
    },
  };
}
