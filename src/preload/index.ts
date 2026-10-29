import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppSettings } from "../shared/settings-types";
import type {
  MultiCliWorkApi,
  SessionAttention,
  TerminalSizeOwner,
  UpdaterStatus,
  WindowChromeState,
} from "../shared/api-types";
import type { RemoteHostView, RemoteShelf, RemoteViewAction } from "../shared/remote-types";
import type { SessionIndicatorsUpdate, TerminalEvent } from "../shared/terminal-types";
import type { UsageSnapshot } from "../shared/usage-types";
import type { RepoSyncSessionNotice } from "../shared/repo-sync-types";
import type { BoardMessage } from "../shared/board-types";
import type { SessionPreset } from "../shared/preset-types";

const api: MultiCliWorkApi = {
  activity: { list: (sessionId) => ipcRenderer.invoke("activity:list", sessionId) },
  workbench: {
    saveLaunchProfile: (profile) => ipcRenderer.invoke("workbench:save-launch-profile", profile),
    removeLaunchProfile: (id) => ipcRenderer.invoke("workbench:remove-launch-profile", id),
    setDefaultLaunchProfile: (agent, id) => ipcRenderer.invoke("workbench:default-launch-profile", agent, id),
    saveView: (view) => ipcRenderer.invoke("workbench:save-view", view),
    removeView: (id) => ipcRenderer.invoke("workbench:remove-view", id),
    state: () => ipcRenderer.invoke("workbench:state"),
    savePrompt: (prompt) => ipcRenderer.invoke("workbench:save-prompt", prompt),
    removePrompt: (id) => ipcRenderer.invoke("workbench:remove-prompt", id),
    importPrompts: (text) => ipcRenderer.invoke("workbench:import-prompts", text),
    exportPrompts: () => ipcRenderer.invoke("workbench:export-prompts"),
    saveDraft: (id, text) => ipcRenderer.invoke("workbench:save-draft", id, text),
  },
  deliveries: {
    list: () => ipcRenderer.invoke("deliveries:list"),
    send: (sessionId, text) => ipcRenderer.invoke("deliveries:send", sessionId, text),
    edit: (id, text) => ipcRenderer.invoke("deliveries:edit", id, text),
    drop: (id) => ipcRenderer.invoke("deliveries:drop", id),
    sendNow: (id) => ipcRenderer.invoke("deliveries:send-now", id),
    move: (id, direction) => ipcRenderer.invoke("deliveries:move", id, direction),
  },
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
    syncRepos: (workProjectId) => ipcRenderer.invoke("work-projects:sync-repos", workProjectId),
    lastRepoSync: (workProjectId) => ipcRenderer.invoke("work-projects:last-repo-sync", workProjectId),
    onRepoSyncNotice(listener) {
      const handler = (_event: Electron.IpcRendererEvent, notice: RepoSyncSessionNotice) => listener(notice);
      ipcRenderer.on("repo-sync:session-notice", handler);
      return () => ipcRenderer.removeListener("repo-sync:session-notice", handler);
    },
  },
  pcRoots: {
    get: () => ipcRenderer.invoke("pc-roots:get"),
    redetect: () => ipcRenderer.invoke("pc-roots:redetect"),
    choose: (key) => ipcRenderer.invoke("pc-roots:choose", key),
    clear: (key) => ipcRenderer.invoke("pc-roots:clear", key),
    setDriveKind: (kind) => ipcRenderer.invoke("pc-roots:set-drive-kind", kind),
  },
  profile: {
    defaultPath: () => ipcRenderer.invoke("profile:default-path"),
    export: () => ipcRenderer.invoke("profile:export"),
    preview: () => ipcRenderer.invoke("profile:preview"),
    apply: () => ipcRenderer.invoke("profile:apply"),
  },
  drive: {
    overview: () => ipcRenderer.invoke("drive:overview"),
    status: (workProjectId) => ipcRenderer.invoke("drive:status", workProjectId),
    link: (workProjectId) => ipcRenderer.invoke("drive:link", workProjectId),
    createFolder: (workProjectId, options) => ipcRenderer.invoke("drive:create-folder", workProjectId, options),
    importFolders: (names) => ipcRenderer.invoke("drive:import", names),
    migrateDocs: (workProjectId, projectId) => ipcRenderer.invoke("drive:migrate-docs", workProjectId, projectId),
    reveal: (workProjectId, subfolder) => ipcRenderer.invoke("drive:reveal", workProjectId, subfolder ?? null),
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
    onChange(listener) {
      const handler = () => listener();
      ipcRenderer.on("workspace:changed", handler);
      return () => {
        ipcRenderer.removeListener("workspace:changed", handler);
      };
    },
  },
  worktrees: {
    list: () => ipcRenderer.invoke("worktrees:list"),
    sync: () => ipcRenderer.invoke("worktrees:sync"),
    creationOptions: (projectId) => ipcRenderer.invoke("worktrees:creation-options", projectId),
    previewPath: (projectId, branch) => ipcRenderer.invoke("worktrees:preview-path", projectId, branch),
    create: (projectId, request) => ipcRenderer.invoke("worktrees:create", projectId, request),
    unlock: (worktreeId) => ipcRenderer.invoke("worktrees:unlock", worktreeId),
    cleanupStale: (projectId) => ipcRenderer.invoke("worktrees:cleanup-stale", projectId),
    remove: (worktreeId, force, options) => ipcRenderer.invoke("worktrees:remove", worktreeId, force, options),
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
    openEntry: (target, relativePath, options) =>
      ipcRenderer.invoke("workspace-files:open-entry", target, relativePath, options),
    absolutePath: (target, relativePath) => ipcRenderer.invoke("workspace-files:absolute-path", target, relativePath),
    reveal: (target, relativePath) => ipcRenderer.invoke("workspace-files:reveal", target, relativePath),
    openInEditor: (target, relativePath, position) =>
      ipcRenderer.invoke("workspace-files:open-in-editor", target, relativePath, position),
    resolveTerminalPath: (sessionId, raw) => ipcRenderer.invoke("workspace-files:resolve-terminal-path", sessionId, raw),
    create: (target, parentRelativePath, name, kind) =>
      ipcRenderer.invoke("workspace-files:create", target, parentRelativePath, name, kind),
    rename: (target, relativePath, name) => ipcRenderer.invoke("workspace-files:rename", target, relativePath, name),
    duplicate: (target, relativePath) => ipcRenderer.invoke("workspace-files:duplicate", target, relativePath),
    trash: (target, relativePath) => ipcRenderer.invoke("workspace-files:trash", target, relativePath),
    changedPaths: (target) => ipcRenderer.invoke("workspace-files:changed-paths", target),
    clearChanges: (target) => ipcRenderer.invoke("workspace-files:clear-changes", target),
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
    open: (viewId, target, relativePath, bounds) => ipcRenderer.invoke("html-preview:open", viewId, target, relativePath, bounds),
    setBounds: (viewId, bounds) => ipcRenderer.invoke("html-preview:set-bounds", viewId, bounds),
    reload: (viewId) => ipcRenderer.invoke("html-preview:reload", viewId),
    close: (viewId) => ipcRenderer.invoke("html-preview:close", viewId),
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
    onShelfMoveRequested(listener) {
      const handler = (_event: Electron.IpcRendererEvent, request: { sessionId: string; shelf: RemoteShelf }) =>
        listener(request.sessionId, request.shelf);
      ipcRenderer.on("shelves:move-requested", handler);
      return () => ipcRenderer.removeListener("shelves:move-requested", handler);
    },
    onViewRequested(listener) {
      const handler = (_event: Electron.IpcRendererEvent, action: RemoteViewAction) => listener(action);
      ipcRenderer.on("mirror:view-requested", handler);
      return () => ipcRenderer.removeListener("mirror:view-requested", handler);
    },
  },
  providers: {
    availability: () => ipcRenderer.invoke("providers:availability"),
  },
  terminals: {
    fork: (input) => ipcRenderer.invoke("terminals:fork", input),
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
    exportLog: (sessionId, fileLabel) => ipcRenderer.invoke("terminals:export-log", sessionId, fileLabel),
    select: (projectId, sessionId) => ipcRenderer.invoke("terminals:select", projectId, sessionId),
    setVisibleSessions: (sessionIds) => ipcRenderer.invoke("terminals:set-visible-sessions", sessionIds),
    setExposedSessions: (sessionIds) => ipcRenderer.invoke("terminals:set-exposed-sessions", sessionIds),
    setSlotViews: (input) => ipcRenderer.invoke("terminals:set-slot-views", input),
    onEvent(listener) {
      const handler = (_event: Electron.IpcRendererEvent, terminalEvent: TerminalEvent) => listener(terminalEvent);
      ipcRenderer.on("terminal:event", handler);
      return () => ipcRenderer.removeListener("terminal:event", handler);
    },
    sizeOwners: () => ipcRenderer.invoke("terminals:size-owners"),
    onSizeOwner(listener) {
      const handler = (_event: Electron.IpcRendererEvent, owner: TerminalSizeOwner) => listener(owner);
      ipcRenderer.on("terminals:size-owner", handler);
      return () => ipcRenderer.removeListener("terminals:size-owner", handler);
    },
    reclaimSize: (sessionId) => ipcRenderer.invoke("terminals:reclaim-size", sessionId),
    indicators: () => ipcRenderer.invoke("terminals:indicators"),
    onIndicators(listener) {
      const handler = (_event: Electron.IpcRendererEvent, update: SessionIndicatorsUpdate) => listener(update);
      ipcRenderer.on("terminals:indicators", handler);
      return () => ipcRenderer.removeListener("terminals:indicators", handler);
    },
  },
  usage: {
    history: () => ipcRenderer.invoke("usage:history"),
    state: () => ipcRenderer.invoke("usage:state"),
    refresh: () => ipcRenderer.invoke("usage:refresh"),
    onChange(listener) {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: UsageSnapshot) => listener(snapshot);
      ipcRenderer.on("usage:changed", handler);
      return () => ipcRenderer.removeListener("usage:changed", handler);
    },
  },
  board: {
    list: (projectId) => ipcRenderer.invoke("board:list", projectId),
    post: (input) => ipcRenderer.invoke("board:post", input),
    onChange(listener) {
      const handler = (_event: Electron.IpcRendererEvent, message: BoardMessage) => listener(message);
      ipcRenderer.on("board:changed", handler);
      return () => ipcRenderer.removeListener("board:changed", handler);
    },
  },
  presets: {
    list: () => ipcRenderer.invoke("presets:list"),
    save: (preset) => ipcRenderer.invoke("presets:save", preset),
    remove: (presetId) => ipcRenderer.invoke("presets:remove", presetId),
    launch: (input) => ipcRenderer.invoke("presets:launch", input),
    onChange(listener) {
      const handler = (_event: Electron.IpcRendererEvent, presets: SessionPreset[]) => listener(presets);
      ipcRenderer.on("presets:changed", handler);
      return () => ipcRenderer.removeListener("presets:changed", handler);
    },
  },
  worktreeScripts: {
    get: (projectId) => ipcRenderer.invoke("worktree-scripts:get", projectId),
    set: (projectId, scripts) => ipcRenderer.invoke("worktree-scripts:set", projectId, scripts),
  },
  notion: {
    status: () => ipcRenderer.invoke("notion:status"),
    setToken: (token) => ipcRenderer.invoke("notion:set-token", token),
    clearToken: () => ipcRenderer.invoke("notion:clear-token"),
    inspectLink: (url) => ipcRenderer.invoke("notion:inspect-link", url),
  },
  remote: {
    status: () => ipcRenderer.invoke("remote:status"),
    issuePairingCode: () => ipcRenderer.invoke("remote:issue-pairing-code"),
    listDevices: () => ipcRenderer.invoke("remote:list-devices"),
    revokeDevice: (deviceId) => ipcRenderer.invoke("remote:revoke-device", deviceId),
    publishMirror: (mirror) => ipcRenderer.invoke("remote:publish-mirror", mirror),
  },
  remoteHosts: {
    list: () => ipcRenderer.invoke("remote-hosts:list"),
    add: (input) => ipcRenderer.invoke("remote-hosts:add", input),
    remove: (hostId) => ipcRenderer.invoke("remote-hosts:remove", hostId),
    open: (hostId) => ipcRenderer.invoke("remote-hosts:open", hostId),
    setNotify: (hostId, notify) => ipcRenderer.invoke("remote-hosts:set-notify", hostId, notify),
    onChanged(listener) {
      const handler = (_event: Electron.IpcRendererEvent, hosts: RemoteHostView[]) => listener(hosts);
      ipcRenderer.on("remote-hosts:changed", handler);
      return () => ipcRenderer.removeListener("remote-hosts:changed", handler);
    },
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
let nextV2Reference = 0;
if (process.argv.includes("--mcw-v2")) {
  const v2: import("../shared/v2-api").McwV2Api = {
    version: 2, enabled: () => ipcRenderer.invoke("v2:enabled"), configuration: () => ipcRenderer.invoke("v2:configuration"),
    listTasks: hostId => ipcRenderer.invoke("v2:tasks",hostId), createTask: input => ipcRenderer.invoke("v2:task-create", input), inspectTask: (id,hostId) => ipcRenderer.invoke("v2:task-inspect", id,hostId),
    taskAction: (id, action, input,hostId) => ipcRenderer.invoke("v2:task-action", id, action, input,hostId),
    terminalViewId: (sessionId,hostId) => ipcRenderer.invoke("v2:terminal-view-id",sessionId,hostId),
    onState: callback => {const listener=(_event:Electron.IpcRendererEvent,value:Parameters<typeof callback>[0])=>callback(value);ipcRenderer.on("v2:state",listener);return()=>ipcRenderer.removeListener("v2:state",listener);},
    hostState: () => ipcRenderer.invoke("v2:host-state"),
    localConnection:()=>ipcRenderer.invoke("v2:local-connection"),listHosts:()=>ipcRenderer.invoke("v2:hosts"),
    configureHost:registration=>ipcRenderer.invoke("v2:host-configure",registration),removeHost:id=>ipcRenderer.invoke("v2:host-remove",id),
    startTask: (id, input) => ipcRenderer.invoke("v2:task-start", id, input), repositoryHead: directory => ipcRenderer.invoke("v2:repository-head", directory),
    listTerminals: () => ipcRenderer.invoke("v2:terminals"), createTerminal: input => ipcRenderer.invoke("v2:terminal-create", input),
    subscribeTerminal: (id, callback) => {
      const reference = String(++nextV2Reference);
      const listener = (_event: Electron.IpcRendererEvent, sessionId: string, value: unknown) => {if (sessionId === id) callback(value);};
      ipcRenderer.on("v2:terminal-event", listener);
      void ipcRenderer.invoke("v2:terminal-subscribe", id, reference).catch(error => callback({type:"error",error:String(error)}));
      return () => {ipcRenderer.removeListener("v2:terminal-event", listener);void ipcRenderer.invoke("v2:terminal-unsubscribe", id, reference).catch(() => undefined);};
    },
    terminalCommand: (id, command) => ipcRenderer.invoke("v2:terminal-command", id, command), recoveryStatus: () => ipcRenderer.invoke("v2:recovery-status"),
  };
  contextBridge.exposeInMainWorld("mcwV2", v2);
}
