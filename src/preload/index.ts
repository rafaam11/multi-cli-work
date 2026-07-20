import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { MultiCliWorkApi, SessionAttention, UpdaterStatus } from "../shared/api-types";
import type { TerminalEvent } from "../shared/terminal-types";

const api: MultiCliWorkApi = {
  platform: process.platform,
  clipboard: {
    readText: () => ipcRenderer.invoke("clipboard:read-text"),
    writeText: (text) => ipcRenderer.invoke("clipboard:write-text", text),
  },
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
    gitDiff: (projectId) => ipcRenderer.invoke("projects:git-diff", projectId),
  },
  worktrees: {
    list: () => ipcRenderer.invoke("worktrees:list"),
    create: (projectId, branch) => ipcRenderer.invoke("worktrees:create", projectId, branch),
    remove: (worktreeId, force) => ipcRenderer.invoke("worktrees:remove", worktreeId, force),
    reveal: (worktreeId) => ipcRenderer.invoke("worktrees:reveal", worktreeId),
    openInEditor: (worktreeId) => ipcRenderer.invoke("worktrees:open-editor", worktreeId),
    gitStatus: (worktreeId) => ipcRenderer.invoke("worktrees:git-status", worktreeId),
    gitDiff: (worktreeId) => ipcRenderer.invoke("worktrees:git-diff", worktreeId),
  },
  agents: {
    list: () => ipcRenderer.invoke("agents:list"),
    edit: () => ipcRenderer.invoke("agents:edit"),
  },
  files: {
    // Electron 32 removed File.path; this preload call is the only way a dragged File resolves
    // to the absolute path the renderer pastes into an agent prompt.
    pathFor: (file) => webUtils.getPathForFile(file),
  },
  // Separate from `files` above (dragged-OS-file path resolution) — this is the project/worktree
  // file explorer's own read/write surface, keyed by target rather than an absolute path.
  workspaceFiles: {
    listDirectory: (target, relativePath) =>
      ipcRenderer.invoke("workspace-files:list-directory", target, relativePath),
    readFile: (target, relativePath) => ipcRenderer.invoke("workspace-files:read-file", target, relativePath),
    writeFile: (target, relativePath, content) =>
      ipcRenderer.invoke("workspace-files:write-file", target, relativePath, content),
    runExecutable: (target, relativePath) => ipcRenderer.invoke("workspace-files:run-executable", target, relativePath),
  },
  git: {
    panelData: (target) => ipcRenderer.invoke("git:panel-data", target),
    checkout: (target, branch) => ipcRenderer.invoke("git:checkout", target, branch),
    createBranch: (target, branch) => ipcRenderer.invoke("git:create-branch", target, branch),
    commit: (target, request) => ipcRenderer.invoke("git:commit", target, request),
    push: (target) => ipcRenderer.invoke("git:push", target),
    fetch: (target) => ipcRenderer.invoke("git:fetch", target),
    pull: (target) => ipcRenderer.invoke("git:pull", target),
    fileOriginal: (target, relativePath) => ipcRenderer.invoke("git:file-original", target, relativePath),
  },
  gitGraph: {
    open: (target, bounds) => ipcRenderer.invoke("git-graph:open", target, bounds),
    setBounds: (bounds) => ipcRenderer.invoke("git-graph:set-bounds", bounds),
    close: () => ipcRenderer.invoke("git-graph:close"),
  },
  htmlPreview: {
    open: (target, relativePath, bounds) => ipcRenderer.invoke("html-preview:open", target, relativePath, bounds),
    setBounds: (bounds) => ipcRenderer.invoke("html-preview:set-bounds", bounds),
    reload: () => ipcRenderer.invoke("html-preview:reload"),
    close: () => ipcRenderer.invoke("html-preview:close"),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  },
  attention: {
    state: () => ipcRenderer.invoke("attention:state"),
    onEvent(listener) {
      const handler = (_event: Electron.IpcRendererEvent, unread: Record<string, SessionAttention>) =>
        listener(unread);
      ipcRenderer.on("attention:event", handler);
      return () => ipcRenderer.removeListener("attention:event", handler);
    },
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
    split: (sessionId) => ipcRenderer.invoke("terminals:split", sessionId),
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
