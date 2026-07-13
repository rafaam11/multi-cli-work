import { contextBridge, ipcRenderer } from "electron";
import type { MultiCliWorkApi, UpdaterStatus } from "../shared/api-types";
import type { TerminalEvent } from "../shared/terminal-types";

const api: MultiCliWorkApi = {
  platform: process.platform,
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    addFolder: () => ipcRenderer.invoke("projects:add-folder"),
    update: (projectId, patch) => ipcRenderer.invoke("projects:update", projectId, patch),
    remove: (projectId) => ipcRenderer.invoke("projects:remove", projectId),
    relink: (projectId) => ipcRenderer.invoke("projects:relink", projectId),
    restoreBackup: () => ipcRenderer.invoke("projects:restore-backup"),
    reveal: (projectId) => ipcRenderer.invoke("projects:reveal", projectId),
    openInEditor: (projectId) => ipcRenderer.invoke("projects:open-editor", projectId),
    openOnGitHub: (projectId) => ipcRenderer.invoke("projects:open-github", projectId),
    gitStatus: (projectId) => ipcRenderer.invoke("projects:git-status", projectId),
  },
  agents: {
    list: () => ipcRenderer.invoke("agents:list"),
    edit: () => ipcRenderer.invoke("agents:edit"),
  },
  providers: {
    availability: () => ipcRenderer.invoke("providers:availability"),
  },
  terminals: {
    list: () => ipcRenderer.invoke("terminals:list"),
    state: () => ipcRenderer.invoke("terminals:state"),
    create: (input) => ipcRenderer.invoke("terminals:create", input),
    createTool: (input) => ipcRenderer.invoke("terminals:create-tool", input),
    attach: (sessionId) => ipcRenderer.invoke("terminals:attach", sessionId),
    write: (sessionId, data) => ipcRenderer.invoke("terminals:write", sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.invoke("terminals:resize", sessionId, cols, rows),
    stop: (sessionId) => ipcRenderer.invoke("terminals:stop", sessionId),
    resume: (input) => ipcRenderer.invoke("terminals:resume", input),
    remove: (sessionId) => ipcRenderer.invoke("terminals:remove", sessionId),
    rename: (sessionId, name) => ipcRenderer.invoke("terminals:rename", sessionId, name),
    select: (projectId, sessionId) => ipcRenderer.invoke("terminals:select", projectId, sessionId),
    onEvent(listener) {
      const handler = (_event: Electron.IpcRendererEvent, terminalEvent: TerminalEvent) => listener(terminalEvent);
      ipcRenderer.on("terminal:event", handler);
      return () => ipcRenderer.removeListener("terminal:event", handler);
    },
  },
  updates: {
    appVersion: () => ipcRenderer.invoke("app:version"),
    status: () => ipcRenderer.invoke("updater:status"),
    check: () => ipcRenderer.invoke("updater:check"),
    install: () => ipcRenderer.invoke("updater:install"),
    openReleases: () => ipcRenderer.invoke("app:open-releases"),
    openRepository: () => ipcRenderer.invoke("app:open-repository"),
    onEvent(listener) {
      const handler = (_event: Electron.IpcRendererEvent, status: UpdaterStatus) => listener(status);
      ipcRenderer.on("updater:event", handler);
      return () => ipcRenderer.removeListener("updater:event", handler);
    },
  },
};

contextBridge.exposeInMainWorld("multiCliWork", api);
