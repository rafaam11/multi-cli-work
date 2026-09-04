import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppSettings } from "../shared/settings-types";
import type { MultiCliWorkApi, SessionAttention, UpdaterStatus, WindowChromeState } from "../shared/api-types";
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
    reorder: (orderedIds) => ipcRenderer.invoke("projects:reorder", orderedIds),
    remove: (projectId) => ipcRenderer.invoke("projects:remove", projectId),
    relink: (projectId) => ipcRenderer.invoke("projects:relink", projectId),
    restoreBackup: () => ipcRenderer.invoke("projects:restore-backup"),
    reveal: (projectId) => ipcRenderer.invoke("projects:reveal", projectId),
    openInEditor: (projectId) => ipcRenderer.invoke("projects:open-editor", projectId),
    openOnGitHub: (projectId) => ipcRenderer.invoke("projects:open-github", projectId),
    gitStatus: (projectId) => ipcRenderer.invoke("projects:git-status", projectId),
    gitDiff: (projectId) => ipcRenderer.invoke("projects:git-diff", projectId),
  },
  workProjects: {
    list: () => ipcRenderer.invoke("work-projects:list"),
    create: (input) => ipcRenderer.invoke("work-projects:create", input),
    update: (workProjectId, patch) => ipcRenderer.invoke("work-projects:update", workProjectId, patch),
    remove: (workProjectId) => ipcRenderer.invoke("work-projects:remove", workProjectId),
    addMember: (workProjectId, projectId, role) =>
      ipcRenderer.invoke("work-projects:add-member", workProjectId, projectId, role),
    removeMember: (workProjectId, projectId) =>
      ipcRenderer.invoke("work-projects:remove-member", workProjectId, projectId),
    reorder: (orderedIds) => ipcRenderer.invoke("work-projects:reorder", orderedIds),
    addMemberFolder: (workProjectId, role) =>
      ipcRenderer.invoke("work-projects:add-member-folder", workProjectId, role),
    chooseLocalFolder: () => ipcRenderer.invoke("work-projects:choose-local-folder"),
    revealLocalFolder: (workProjectId, folderPath) =>
      ipcRenderer.invoke("work-projects:reveal-local-folder", workProjectId, folderPath),
    chooseTeamsSyncRoot: () => ipcRenderer.invoke("work-projects:choose-teams-root"),
    clearTeamsSyncRoot: () => ipcRenderer.invoke("work-projects:clear-teams-root"),
  },
  projectTags: {
    list: () => ipcRenderer.invoke("project-tags:list"),
    set: (workProjectId, tags) => ipcRenderer.invoke("project-tags:set", workProjectId, tags),
  },
  workspace: {
    list: () => ipcRenderer.invoke("workspace:list"),
    add: () => ipcRenderer.invoke("workspace:add"),
    remove: (rootPath) => ipcRenderer.invoke("workspace:remove", rootPath),
    sync: () => ipcRenderer.invoke("workspace:sync"),
  },
  worktrees: {
    list: () => ipcRenderer.invoke("worktrees:list"),
    sync: () => ipcRenderer.invoke("worktrees:sync"),
    creationOptions: (projectId) => ipcRenderer.invoke("worktrees:creation-options", projectId),
    previewPath: (projectId, branch) => ipcRenderer.invoke("worktrees:preview-path", projectId, branch),
    create: (projectId, request) => ipcRenderer.invoke("worktrees:create", projectId, request),
    unlock: (worktreeId) => ipcRenderer.invoke("worktrees:unlock", worktreeId),
    cleanupStale: (projectId) => ipcRenderer.invoke("worktrees:cleanup-stale", projectId),
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
    absolutePath: (target, relativePath) => ipcRenderer.invoke("workspace-files:absolute-path", target, relativePath),
    reveal: (target, relativePath) => ipcRenderer.invoke("workspace-files:reveal", target, relativePath),
    openInEditor: (target, relativePath) => ipcRenderer.invoke("workspace-files:open-in-editor", target, relativePath),
    create: (target, parentRelativePath, name, kind) =>
      ipcRenderer.invoke("workspace-files:create", target, parentRelativePath, name, kind),
    rename: (target, relativePath, name) => ipcRenderer.invoke("workspace-files:rename", target, relativePath, name),
    duplicate: (target, relativePath) => ipcRenderer.invoke("workspace-files:duplicate", target, relativePath),
    trash: (target, relativePath) => ipcRenderer.invoke("workspace-files:trash", target, relativePath),
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
  github: {
    remotes: (projectId) => ipcRenderer.invoke("github:remotes", projectId),
    status: (projectId, remoteName) => ipcRenderer.invoke("github:status", projectId, remoteName),
    authenticate: (projectId, remoteName) => ipcRenderer.invoke("github:authenticate", projectId, remoteName),
    list: (projectId, remoteName, query) => ipcRenderer.invoke("github:list", projectId, remoteName, query),
    detail: (projectId, remoteName, prNumber) => ipcRenderer.invoke("github:detail", projectId, remoteName, prNumber),
    diff: (projectId, remoteName, prNumber) => ipcRenderer.invoke("github:diff", projectId, remoteName, prNumber),
    comment: (projectId, remoteName, prNumber, body) => ipcRenderer.invoke("github:comment", projectId, remoteName, prNumber, body),
    reply: (projectId, remoteName, prNumber, commentId, body) => ipcRenderer.invoke("github:reply", projectId, remoteName, prNumber, commentId, body),
    activeReviews: () => ipcRenderer.invoke("github:active-reviews"),
    startReview: (projectId, remoteName, prNumber, agent) => ipcRenderer.invoke("github:start-review", projectId, remoteName, prNumber, agent),
    refillReview: (reviewId) => ipcRenderer.invoke("github:refill-review", reviewId),
    finishReview: (reviewId, request) => ipcRenderer.invoke("github:finish-review", reviewId, request),
    annotations: (projectId, remoteName, prNumber) => ipcRenderer.invoke("github:annotations", projectId, remoteName, prNumber),
    upsertAnnotation: (projectId, remoteName, prNumber, input) => ipcRenderer.invoke("github:upsert-annotation", projectId, remoteName, prNumber, input),
    deleteAnnotation: (projectId, remoteName, prNumber, annotationId) => ipcRenderer.invoke("github:delete-annotation", projectId, remoteName, prNumber, annotationId),
    sendDraftAnnotations: (projectId, remoteName, prNumber) => ipcRenderer.invoke("github:send-draft-annotations", projectId, remoteName, prNumber),
  },
  gitGraph: {
    list: (target, options) => ipcRenderer.invoke("git-graph:list", target, options),
    commitDetails: (target, hash) => ipcRenderer.invoke("git-graph:commit-details", target, hash),
    fileDiff: (target, hash, path) => ipcRenderer.invoke("git-graph:file-diff", target, hash, path),
    createBranch: (target, hash, name, checkout) => ipcRenderer.invoke("git-graph:create-branch", target, hash, name, checkout),
    createTag: (target, hash, name) => ipcRenderer.invoke("git-graph:create-tag", target, hash, name),
    cherryPick: (target, hash) => ipcRenderer.invoke("git-graph:cherry-pick", target, hash),
    revert: (target, hash) => ipcRenderer.invoke("git-graph:revert", target, hash),
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
  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    state: () => ipcRenderer.invoke("window:state"),
    toggleFullScreen: () => ipcRenderer.invoke("window:toggle-full-screen"),
    toggleDevTools: () => ipcRenderer.invoke("window:toggle-dev-tools"),
    reload: () => ipcRenderer.invoke("window:reload"),
    zoom: (action) => ipcRenderer.invoke("window:zoom", action),
    quit: () => ipcRenderer.invoke("app:quit"),
    onStateChange(listener) {
      const handler = (_event: Electron.IpcRendererEvent, state: WindowChromeState) => listener(state);
      ipcRenderer.on("window:state", handler);
      return () => ipcRenderer.removeListener("window:state", handler);
    },
  },
  navigation: {
    onSessionRequested(listener) {
      const handler = (_event: Electron.IpcRendererEvent, request: { sessionId: string }) =>
        listener(request.sessionId);
      ipcRenderer.on("navigation:session-requested", handler);
      return () => ipcRenderer.removeListener("navigation:session-requested", handler);
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
    attach: (sessionId, size) => ipcRenderer.invoke("terminals:attach", sessionId, size?.cols, size?.rows),
    refresh: (sessionId) => ipcRenderer.invoke("terminals:refresh", sessionId),
    write: (sessionId, data) => ipcRenderer.invoke("terminals:write", sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.invoke("terminals:resize", sessionId, cols, rows),
    stop: (sessionId) => ipcRenderer.invoke("terminals:stop", sessionId),
    resume: (input) => ipcRenderer.invoke("terminals:resume", input),
    remove: (sessionId) => ipcRenderer.invoke("terminals:remove", sessionId),
    rename: (sessionId, name) => ipcRenderer.invoke("terminals:rename", sessionId, name),
    select: (projectId, sessionId) => ipcRenderer.invoke("terminals:select", projectId, sessionId),
    setVisibleSessions: (sessionIds) => ipcRenderer.invoke("terminals:set-visible-sessions", sessionIds),
    setSlotViews: (input) => ipcRenderer.invoke("terminals:set-slot-views", input),
    onEvent(listener) {
      const handler = (_event: Electron.IpcRendererEvent, terminalEvent: TerminalEvent) => listener(terminalEvent);
      ipcRenderer.on("terminal:event", handler);
      return () => ipcRenderer.removeListener("terminal:event", handler);
    },
  },
  notion: {
    status: () => ipcRenderer.invoke("notion:status"),
    setToken: (token) => ipcRenderer.invoke("notion:set-token", token),
    clearToken: () => ipcRenderer.invoke("notion:clear-token"),
    inspectLink: (url) => ipcRenderer.invoke("notion:inspect-link", url),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (patch) => ipcRenderer.invoke("settings:update", patch),
    onChange(listener) {
      const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings) => listener(settings);
      ipcRenderer.on("settings:changed", handler);
      return () => {
        ipcRenderer.removeListener("settings:changed", handler);
      };
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
