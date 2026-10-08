import type {
  AgentsSnapshot,
  CreateTerminalInput,
  CreateToolTerminalInput,
  GitCommitRequest,
  GitCommitDetails,
  GitCommitFileDiff,
  GitDiffResult,
  GitFileOriginal,
  GitGraphPage,
  GitPanelData,
  GitStatusResult,
  HtmlPreviewBounds,
  ProviderAvailability,
  ResumeTerminalInput,
  SessionAttention,
  SlotViewsInput,
  TerminalSizeOwner,
  UpdaterStatus,
  WindowChromeState,
  WindowZoomAction,
} from "../shared/api-types";
import { type AppSettings, type AppSettingsPatch } from "../shared/settings-types";
import type { FileTreeEntry, WorkspaceChangedPaths, WorkspaceFileContent } from "../shared/file-explorer-types";
import type {
  ActivePullRequestReview, GitHubIntegrationStatus, GitHubRemote, PullRequestDetail,
  PullRequestDiffFile, PullRequestListPage, PullRequestListQuery, PullRequestReviewAgent,
  PullRequestReviewAnnotation, PullRequestReviewAnnotationInput, PullRequestReviewAnnotationSendResult,
  PullRequestReviewAnnotationSnapshot, PullRequestReviewFinishRequest, PullRequestReviewFinishResult, PullRequestReviewStartResult,
} from "../shared/github-types";
import type { NotionLinkCheck, NotionTokenStatus } from "../shared/notion-types";
import type {
  RemoteAccessStatus,
  RemoteDeviceInfo,
  RemoteHostAddInput,
  RemoteHostView,
  RemotePairingCode,
} from "../shared/remote-types";
import type { ProjectRegistrySnapshot, ProjectRegistryV1, SharedProject } from "../shared/project-types";
import type { ProjectTagsV1 } from "../shared/project-tags-types";
import type { WorkProjectRegistryV1, WorkProjectRole } from "../shared/work-project-types";
import type { WorkspaceSnapshot } from "../shared/workspace-types";
import type {
  SharedWorktree,
  WorktreeCreateOptions,
  WorktreeCreateRequest,
  WorktreeRemovalResult,
  WorktreeWorkspaceSnapshot,
} from "../shared/worktree-types";
import type { ProjectMetadataUpdate } from "./projects/project-service";
import type { WorkProjectMetadataUpdate } from "./projects/work-project-service";

/**
 * main 프로세스의 서비스들 가운데 IPC가 쓰는 부분. registerMainIpc가 이것들을 받아 채널을 단다 —
 * 테스트는 가짜를 넣는다.
 */

export interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void;
}

export interface ProjectServiceGateway {
  findMissingProjectRoots(registry: ProjectRegistryV1): Promise<string[]>;
  registerManualFolder(rootPath: string, displayName?: string | null): Promise<ProjectRegistryV1>;
  updateProjectMetadata(projectId: string, update: ProjectMetadataUpdate): Promise<ProjectRegistryV1>;
  reorderProjects(orderedIds: readonly string[]): Promise<ProjectRegistryV1>;
  removeProject(projectId: string): Promise<ProjectRegistryV1>;
  relinkProject(projectId: string, rootPath: string): Promise<ProjectRegistryV1>;
}

export interface WorkProjectServiceGateway {
  createWorkProject(input: { name: string; category?: string }): Promise<WorkProjectRegistryV1>;
  updateWorkProjectMetadata(workProjectId: string, update: WorkProjectMetadataUpdate): Promise<WorkProjectRegistryV1>;
  removeWorkProject(workProjectId: string): Promise<WorkProjectRegistryV1>;
  addMember(workProjectId: string, projectId: string, role: WorkProjectRole): Promise<WorkProjectRegistryV1>;
  removeMember(workProjectId: string, projectId: string): Promise<WorkProjectRegistryV1>;
  removeProjectReferences(projectId: string): Promise<WorkProjectRegistryV1>;
  reorderWorkProjects(orderedIds: readonly string[]): Promise<WorkProjectRegistryV1>;
  setTeamsSyncRoot(rootPath: string | null): Promise<WorkProjectRegistryV1>;
}

/**
 * ws-root 워크스페이스 루트. 렌더러는 경로를 **목록에 있는 것만** 지목할 수 있고, 추가는
 * 폴더 대화상자를 거친다 — `projects:add-folder`와 같은 약속이다.
 */
export interface WorkspaceGateway {
  snapshot(): Promise<WorkspaceSnapshot>;
  addRoot(rootPath: string): Promise<WorkspaceSnapshot>;
  removeRoot(rootPath: string): Promise<WorkspaceSnapshot>;
  sync(): Promise<WorkspaceSnapshot>;
}

/** 업무 프로젝트 자유 태그. `work-projects.json`과 별도 파일에 사는 이유는 registry 쪽 주석 참고. */
export interface ProjectTagsGateway {
  list(): Promise<ProjectTagsV1>;
  set(workProjectId: string, tags: readonly string[]): Promise<ProjectTagsV1>;
}

export interface TerminalCoordinatorGateway {
  list(): unknown;
  state(): Promise<unknown>;
  create(input: CreateTerminalInput, options?: { updateSelection?: boolean }): Promise<unknown>;
  createTool(input: CreateToolTerminalInput): Promise<unknown>;
  /** The renderer-facing attach: it may lazily auto-resume a session interrupted by app shutdown. */
  attachForRenderer(sessionId: string, size?: { cols: number; rows: number }): Promise<unknown>;
  /** Side-effect-free attach used by an explicit screen refresh. */
  attach(sessionId: string): Promise<unknown>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  stop(sessionId: string): Promise<void>;
  resume(input: ResumeTerminalInput): Promise<unknown>;
  remove(sessionId: string): Promise<void>;
  removeProjectSessions(projectId: string): Promise<void>;
  rename(sessionId: string, name: string | null): Promise<unknown>;
  logText(sessionId: string): Promise<string>;
  select(projectId: string | null, sessionId: string | null): Promise<unknown>;
  setVisibleSessions(sessionIds: readonly string[]): Promise<unknown>;
  setSlotViews(input: SlotViewsInput): Promise<unknown>;
}

export interface RemoteGateway {
  status(): RemoteAccessStatus;
  issuePairingCode(): Promise<RemotePairingCode>;
  listDevices(): Promise<RemoteDeviceInfo[]>;
  revokeDevice(deviceId: string): Promise<void>;
}

/** 이 PC가 클라이언트로서 붙는 다른 PC들. */
export interface RemoteHostsGateway {
  list(): Promise<RemoteHostView[]>;
  add(input: RemoteHostAddInput): Promise<RemoteHostView>;
  remove(hostId: string): Promise<void>;
  open(hostId: string): Promise<void>;
  setNotify(hostId: string, notify: boolean): Promise<void>;
}

/** 데스크톱 패인의 resize·입력은 크기 중재자를 거친다 — 폰이 크기를 가져간 세션을 되찾는 계기. */
export interface TerminalSizeGateway {
  desktopResize(sessionId: string, cols: number, rows: number): Promise<void>;
  /** 원격 기기가 크기를 가졌다면 데스크톱의 마지막 크기로 되찾는다. */
  desktopInput(sessionId: string): Promise<void>;
  deviceOwners(): Promise<TerminalSizeOwner[]>;
}

export interface UpdaterGateway {
  status(): UpdaterStatus;
  check(): Promise<void>;
  install(): Promise<void>;
  openReleases(): void;
  openRepository(): void;
}

export interface ProjectActionsGateway {
  reveal(rootPath: string): Promise<void>;
  openInEditor(rootPath: string): Promise<void>;
  openOnGitHub(rootPath: string): Promise<void>;
  gitStatus(rootPath: string): Promise<GitStatusResult>;
  gitDiff(rootPath: string): Promise<GitDiffResult>;
}

export interface WorktreeGateway {
  list(): Promise<SharedWorktree[]>;
  sync(projects: SharedProject[]): Promise<WorktreeWorkspaceSnapshot>;
  get(worktreeId: string): Promise<SharedWorktree | null>;
  creationOptions(projectId: string): Promise<WorktreeCreateOptions>;
  previewPath(projectId: string, branch: string): Promise<string>;
  create(projectId: string, request: WorktreeCreateRequest): Promise<SharedWorktree>;
  unlock(worktreeId: string): Promise<void>;
  cleanupStale(projectId: string): Promise<WorktreeWorkspaceSnapshot>;
  ownerForPath(rootPath: string, projects: SharedProject[]): Promise<{ projectId: string; worktreeId: string | null } | null>;
  remove(worktreeId: string, force: boolean): Promise<WorktreeRemovalResult>;
}

export interface WorkspaceFilesGateway {
  listDirectory(rootPath: string, relativePath: string): Promise<FileTreeEntry[]>;
  readFile(rootPath: string, relativePath: string): Promise<WorkspaceFileContent>;
  writeFile(rootPath: string, relativePath: string, content: string): Promise<void>;
  /** Opens a file with its OS-associated program; run-confirm extensions need `confirmedRun: true`. */
  openEntry(rootPath: string, relativePath: string, options: { confirmedRun: boolean }): Promise<void>;
  absolutePath(rootPath: string, relativePath: string): Promise<string>;
  reveal(rootPath: string, relativePath: string): Promise<void>;
  openInEditor(rootPath: string, relativePath: string): Promise<void>;
  create(rootPath: string, parentRelativePath: string, name: string, kind: "file" | "directory"): Promise<string>;
  rename(rootPath: string, relativePath: string, name: string): Promise<string>;
  duplicate(rootPath: string, relativePath: string): Promise<string>;
  trash(rootPath: string, relativePath: string): Promise<void>;
  /** Agent-edited files within this root, plus the cutoff for "changed since" mtime highlighting. */
  changedPaths(rootPath: string): Promise<WorkspaceChangedPaths>;
  /** Clears this root's slice of the agent-edit index and resets its baseline to now. */
  clearChanges(rootPath: string): Promise<void>;
}

export interface GitGateway {
  panelData(rootPath: string): Promise<GitPanelData>;
  checkout(rootPath: string, branch: string): Promise<void>;
  createBranch(rootPath: string, branch: string): Promise<void>;
  commit(rootPath: string, request: GitCommitRequest): Promise<void>;
  push(rootPath: string): Promise<void>;
  fetch(rootPath: string): Promise<void>;
  pull(rootPath: string): Promise<void>;
  fileOriginal(rootPath: string, relativePath: string): Promise<GitFileOriginal>;
}

export interface GitHubGateway {
  remotes(projectId: string): Promise<GitHubRemote[]>;
  status(projectId: string, remoteName: string): Promise<GitHubIntegrationStatus>;
  authenticate(projectId: string, remoteName: string): Promise<unknown>;
  list(projectId: string, remoteName: string, query: PullRequestListQuery): Promise<PullRequestListPage>;
  detail(projectId: string, remoteName: string, prNumber: number): Promise<PullRequestDetail>;
  diff(projectId: string, remoteName: string, prNumber: number): Promise<PullRequestDiffFile[]>;
  comment(projectId: string, remoteName: string, prNumber: number, body: string): Promise<void>;
  reply(projectId: string, remoteName: string, prNumber: number, commentId: string, body: string): Promise<void>;
  activeReviews(): Promise<ActivePullRequestReview[]>;
  startReview(projectId: string, remoteName: string, prNumber: number, agent: PullRequestReviewAgent): Promise<PullRequestReviewStartResult>;
  refillReview(reviewId: string): Promise<string>;
  finishReview(reviewId: string, request: PullRequestReviewFinishRequest): Promise<PullRequestReviewFinishResult>;
  annotations(projectId: string, remoteName: string, prNumber: number): Promise<PullRequestReviewAnnotationSnapshot>;
  upsertAnnotation(projectId: string, remoteName: string, prNumber: number, input: PullRequestReviewAnnotationInput): Promise<PullRequestReviewAnnotation>;
  deleteAnnotation(projectId: string, remoteName: string, prNumber: number, annotationId: string): Promise<void>;
  sendDraftAnnotations(projectId: string, remoteName: string, prNumber: number): Promise<PullRequestReviewAnnotationSendResult>;
}

export interface GitGraphGateway {
  list(rootPath: string, options: { offset: number; limit: number }): Promise<GitGraphPage>;
  commitDetails(rootPath: string, hash: string): Promise<GitCommitDetails>;
  fileDiff(rootPath: string, hash: string, path: string): Promise<GitCommitFileDiff>;
  createBranch(rootPath: string, hash: string, name: string, checkout: boolean): Promise<void>;
  createTag(rootPath: string, hash: string, name: string): Promise<void>;
  cherryPick(rootPath: string, hash: string): Promise<void>;
  revert(rootPath: string, hash: string): Promise<void>;
}

export interface HtmlPreviewGateway {
  open(viewId: string, rootPath: string, relativePath: string, bounds: HtmlPreviewBounds): Promise<void>;
  setBounds(viewId: string, bounds: HtmlPreviewBounds): void;
  reload(viewId: string): void;
  close(viewId: string): void;
}

export interface ShellGateway {
  openExternal(url: string): Promise<void>;
}

export interface ClipboardGateway {
  readText(): string;
  writeText(text: string): void;
}

export interface NotionGateway {
  status(): Promise<NotionTokenStatus>;
  setToken(token: string): Promise<NotionTokenStatus>;
  clearToken(): Promise<NotionTokenStatus>;
  inspectLink(url: string): Promise<NotionLinkCheck>;
}

/**
 * The renderer draws the title bar, so everything the native caption used to do has to come back
 * through here. `close` keeps the app's own close semantics (hide to tray); `quit` is the menu's
 * 종료, which goes through the session-stop confirmation instead.
 */
export interface WindowControlsGateway {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  state(): WindowChromeState;
  toggleFullScreen(): void;
  toggleDevTools(): void;
  reload(): void;
  zoom(action: WindowZoomAction): void;
  quit(): Promise<void>;
}

export interface MainIpcDependencies {
  projectService: ProjectServiceGateway;
  workProjectService: WorkProjectServiceGateway;
  readWorkProjectRegistry(): Promise<WorkProjectRegistryV1>;
  workspace: WorkspaceGateway;
  projectTags: ProjectTagsGateway;
  coordinator: TerminalCoordinatorGateway;
  updater: UpdaterGateway;
  projectActions: ProjectActionsGateway;
  worktrees: WorktreeGateway;
  workspaceFiles: WorkspaceFilesGateway;
  git: GitGateway;
  github: GitHubGateway;
  gitGraph: GitGraphGateway;
  htmlPreview: HtmlPreviewGateway;
  shell: ShellGateway;
  clipboard: ClipboardGateway;
  notion: NotionGateway;
  remote: RemoteGateway;
  remoteHosts: RemoteHostsGateway;
  sizes: TerminalSizeGateway;
  windowControls: WindowControlsGateway;
  appVersion(): string;
  readRegistry(): Promise<ProjectRegistrySnapshot>;
  restoreRegistryBackup(): Promise<void>;
  chooseDirectory(defaultPath?: string): Promise<string | null>;
  /** Asks where to save and writes the text there. Null when the user cancels. */
  saveTextFile(defaultName: string, text: string): Promise<string | null>;
  getAvailability(): Promise<ProviderAvailability>;
  listAgents(): Promise<AgentsSnapshot>;
  editAgents(): Promise<void>;
  attentionState(): Record<string, SessionAttention>;
  onSessionSelected?(sessionId: string | null): void;
  /** 메인 창의 렌더러가 보낸 요청인지. 없으면(테스트) 모든 요청을 받는다. */
  isTrustedSender?(event: unknown): boolean;
  settings: {
    get(): AppSettings;
    update(patch: AppSettingsPatch): Promise<AppSettings>;
  };
}
