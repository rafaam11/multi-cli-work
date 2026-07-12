import { contextBridge, ipcRenderer } from "electron";
import type { MultiCliWorkApi } from "../shared/api-types";
import type { TerminalWorkerEvent } from "../shared/terminal-types";

const api: MultiCliWorkApi = {
  platform: process.platform,
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    refresh: () => ipcRenderer.invoke("projects:refresh"),
    addFolder: () => ipcRenderer.invoke("projects:add-folder"),
    update: (projectId, patch) => ipcRenderer.invoke("projects:update", projectId, patch),
    relink: (projectId) => ipcRenderer.invoke("projects:relink", projectId),
    restoreBackup: () => ipcRenderer.invoke("projects:restore-backup"),
  },
  providers: {
    availability: () => ipcRenderer.invoke("providers:availability"),
  },
  terminals: {
    list: () => ipcRenderer.invoke("terminals:list"),
    state: () => ipcRenderer.invoke("terminals:state"),
    create: (input) => ipcRenderer.invoke("terminals:create", input),
    attach: (sessionId) => ipcRenderer.invoke("terminals:attach", sessionId),
    write: (sessionId, data) => ipcRenderer.invoke("terminals:write", sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.invoke("terminals:resize", sessionId, cols, rows),
    stop: (sessionId) => ipcRenderer.invoke("terminals:stop", sessionId),
    resume: (input) => ipcRenderer.invoke("terminals:resume", input),
    remove: (sessionId) => ipcRenderer.invoke("terminals:remove", sessionId),
    select: (projectId, sessionId) => ipcRenderer.invoke("terminals:select", projectId, sessionId),
    onEvent(listener) {
      const handler = (_event: Electron.IpcRendererEvent, terminalEvent: TerminalWorkerEvent) => listener(terminalEvent);
      ipcRenderer.on("terminal:event", handler);
      return () => ipcRenderer.removeListener("terminal:event", handler);
    },
  },
};

contextBridge.exposeInMainWorld("multiCliWork", api);
