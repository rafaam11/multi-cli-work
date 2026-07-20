import path from "node:path";
import type {
  AgentsSnapshot,
  CreateTerminalInput,
  CreateToolTerminalInput,
  GitCommitRequest,
  GitDiffResult,
  GitFileOriginal,
  GitGraphBounds,
  GitGraphOpenResult,
  GitPanelData,
  GitStatusResult,
  ProjectMetadataPatch,
  ProviderAvailability,
  ResumeTerminalInput,
  SessionAttention,
  UpdaterStatus,
} from "../shared/api-types";
import type { FileExplorerTarget, FileTreeEntry, WorkspaceFileContent } from "../shared/file-explorer-types";
import type { ProjectRegistrySnapshot, ProjectRegistryV1, SharedProject } from "../shared/project-types";
import type { SharedWorktree, WorktreeRemovalResult } from "../shared/worktree-types";
import type { ToolCommand } from "../shared/terminal-types";
import type { ProjectMetadataUpdate } from "./projects/project-service";

export interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void;
}

interface ProjectServiceGateway {
  findMissingProjectRoots(registry: ProjectRegistryV1): Promise<string[]>;
  registerManualFolder(rootPath: string, displayName?: string | null): Promise<ProjectRegistryV1>;
  updateProjectMetadata(projectId: string, update: ProjectMetadataUpdate): Promise<ProjectRegistryV1>;
  removeProject(projectId: string): Promise<ProjectRegistryV1>;
  relinkProject(projectId: string, rootPath: string): Promise<ProjectRegistryV1>;
}

interface TerminalCoordinatorGateway {
  list(): unknown;
  state(): Promise<unknown>;
  create(input: CreateTerminalInput): Promise<unknown>;
  createTool(input: CreateToolTerminalInput): Promise<unknown>;
  /** The renderer-facing attach: it may lazily auto-resume a session interrupted by app shutdown. */
  attachForRenderer(sessionId: string): Promise<unknown>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  stop(sessionId: string): Promise<void>;
  resume(input: ResumeTerminalInput): Promise<unknown>;
  remove(sessionId: string): Promise<void>;
  removeProjectSessions(projectId: string): Promise<void>;
  rename(sessionId: string, name: string | null): Promise<unknown>;
  select(projectId: string | null, sessionId: string | null): Promise<unknown>;
  split(sessionId: string | null): Promise<unknown>;
}

interface UpdaterGateway {
  status(): UpdaterStatus;
  check(): Promise<void>;
  install(): Promise<void>;
  openReleases(): void;
  openRepository(): void;
}

interface ProjectActionsGateway {
  reveal(rootPath: string): Promise<void>;
  openInEditor(rootPath: string): Promise<void>;
  openOnGitHub(rootPath: string): Promise<void>;
  gitStatus(rootPath: string): Promise<GitStatusResult>;
  gitDiff(rootPath: string): Promise<GitDiffResult>;
}

interface WorktreeGateway {
  list(): Promise<SharedWorktree[]>;
  get(worktreeId: string): Promise<SharedWorktree | null>;
  create(projectId: string, branch: string): Promise<SharedWorktree>;
  remove(worktreeId: string, force: boolean): Promise<WorktreeRemovalResult>;
}

interface WorkspaceFilesGateway {
  listDirectory(rootPath: string, relativePath: string): Promise<FileTreeEntry[]>;
  readFile(rootPath: string, relativePath: string): Promise<WorkspaceFileContent>;
  writeFile(rootPath: string, relativePath: string, content: string): Promise<void>;
  runExecutable(rootPath: string, relativePath: string): Promise<void>;
}

interface GitGateway {
  panelData(rootPath: string): Promise<GitPanelData>;
  checkout(rootPath: string, branch: string): Promise<void>;
  createBranch(rootPath: string, branch: string): Promise<void>;
  commit(rootPath: string, request: GitCommitRequest): Promise<void>;
  push(rootPath: string): Promise<void>;
  fetch(rootPath: string): Promise<void>;
  pull(rootPath: string): Promise<void>;
  fileOriginal(rootPath: string, relativePath: string): Promise<GitFileOriginal>;
}

interface GitGraphGateway {
  open(rootPath: string, bounds: GitGraphBounds): Promise<GitGraphOpenResult>;
  setBounds(bounds: GitGraphBounds): void;
  close(): void;
}

interface ShellGateway {
  openExternal(url: string): Promise<void>;
}

interface ClipboardGateway {
  readText(): string;
  writeText(text: string): void;
}

interface MainIpcDependencies {
  projectService: ProjectServiceGateway;
  coordinator: TerminalCoordinatorGateway;
  updater: UpdaterGateway;
  projectActions: ProjectActionsGateway;
  worktrees: WorktreeGateway;
  workspaceFiles: WorkspaceFilesGateway;
  git: GitGateway;
  gitGraph: GitGraphGateway;
  shell: ShellGateway;
  clipboard: ClipboardGateway;
  appVersion(): string;
  readRegistry(): Promise<ProjectRegistrySnapshot>;
  restoreRegistryBackup(): Promise<void>;
  chooseDirectory(): Promise<string | null>;
  getAvailability(): Promise<ProviderAvailability>;
  listAgents(): Promise<AgentsSnapshot>;
  editAgents(): Promise<void>;
  attentionState(): Record<string, SessionAttention>;
  onSessionSelected?(sessionId: string | null): void;
}

const TOOL_COMMANDS: readonly ToolCommand[] = ["claude-update", "codex-update"];
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactObject(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${label} contains unknown fields: ${unknown.join(", ")}`);
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
  return value as number;
}

/**
 * The renderer names an agent; it never spells out an executable. Only the shape of the id is
 * checked here — whether an agent by that name exists is the registry's answer to give, and it comes
 * back as "Unknown agent" from the coordinator.
 */
function validateCreateInput(value: unknown): CreateTerminalInput {
  const input = exactObject(value, ["projectId", "kind", "worktreeId", "cols", "rows"], "Terminal create input");
  if (typeof input.kind !== "string" || !AGENT_ID_PATTERN.test(input.kind)) {
    throw new Error("Terminal kind is invalid");
  }
  if (input.worktreeId !== undefined && (typeof input.worktreeId !== "string" || input.worktreeId.length === 0)) {
    throw new Error("Worktree id is invalid");
  }
  return {
    projectId: nonEmptyString(input.projectId, "Project id"),
    kind: input.kind,
    ...(input.worktreeId !== undefined ? { worktreeId: input.worktreeId } : {}),
    cols: integer(input.cols, "Terminal columns"),
    rows: integer(input.rows, "Terminal rows"),
  };
}

/**
 * Maintenance sessions run a command the renderer never spells out: it may only name one of the
 * commands below, and the main process maps the name to the actual shell command.
 */
function validateCreateToolInput(value: unknown): CreateToolTerminalInput {
  const input = exactObject(value, ["tool", "cols", "rows"], "Tool session input");
  if (!TOOL_COMMANDS.includes(input.tool as ToolCommand)) throw new Error("Tool command is invalid");
  return {
    tool: input.tool as ToolCommand,
    cols: integer(input.cols, "Terminal columns"),
    rows: integer(input.rows, "Terminal rows"),
  };
}

function validateResumeInput(value: unknown): ResumeTerminalInput {
  const input = exactObject(value, ["sessionId", "cols", "rows"], "Terminal resume input");
  return {
    sessionId: nonEmptyString(input.sessionId, "Session id"),
    cols: integer(input.cols, "Terminal columns"),
    rows: integer(input.rows, "Terminal rows"),
  };
}

function validateProjectPatch(value: unknown): ProjectMetadataPatch {
  const patch = exactObject(
    value,
    ["displayName", "status", "memo", "tracks", "hidden", "order"],
    "Project metadata patch",
  );
  return patch as ProjectMetadataPatch;
}

function validateFileExplorerTarget(value: unknown): FileExplorerTarget {
  const target = exactObject(value, ["kind", "id"], "File explorer target");
  if (target.kind !== "project" && target.kind !== "worktree") {
    throw new Error("File explorer target kind must be 'project' or 'worktree'");
  }
  return { kind: target.kind, id: nonEmptyString(target.id, "File explorer target id") };
}

/** relativePath may legitimately be "" (the target's root), unlike every other string field here. */
function relativePathString(value: unknown): string {
  if (typeof value !== "string") throw new Error("Relative path must be a string");
  return value;
}

function validateGitGraphBounds(value: unknown): GitGraphBounds {
  const bounds = exactObject(value, ["x", "y", "width", "height"], "Git Graph bounds");
  const numeric = (input: unknown, label: string): number => {
    if (typeof input !== "number" || !Number.isFinite(input)) throw new Error(`${label} must be a finite number`);
    return input;
  };
  return {
    x: numeric(bounds.x, "x"),
    y: numeric(bounds.y, "y"),
    width: numeric(bounds.width, "width"),
    height: numeric(bounds.height, "height"),
  };
}

function validateGitCommitRequest(value: unknown): GitCommitRequest {
  const input = exactObject(value, ["summary", "description", "paths"], "Git commit input");
  if (typeof input.description !== "string") throw new Error("Commit description must be a string");
  if (!Array.isArray(input.paths) || input.paths.some((path) => typeof path !== "string" || path.length === 0)) {
    throw new Error("Commit paths must be non-empty strings");
  }
  return {
    summary: nonEmptyString(input.summary, "Commit summary"),
    description: input.description,
    paths: input.paths as string[],
  };
}

function externalUrl(value: unknown): string {
  const raw = nonEmptyString(value, "URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("URL is invalid");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs may be opened");
  return url.toString();
}

function selectedProject(registry: ProjectRegistryV1, projectId: string): SharedProject {
  const project = registry.projects[projectId];
  if (!project) throw new Error(`Project not found after update: ${projectId}`);
  return project;
}

function projectForPath(registry: ProjectRegistryV1, rootPath: string): SharedProject {
  const project = Object.values(registry.projects).find(
    (candidate) => path.resolve(candidate.rootPath).toLocaleLowerCase("en-US") === path.resolve(rootPath).toLocaleLowerCase("en-US"),
  );
  if (!project) throw new Error(`Project not found after folder registration: ${rootPath}`);
  return project;
}

export function registerMainIpc(ipc: IpcRegistrar, dependencies: MainIpcDependencies): void {
  const annotateMissingRoots = async (snapshot: ProjectRegistrySnapshot) => ({
    ...snapshot,
    missingRootProjectIds: await dependencies.projectService.findMissingProjectRoots(snapshot.registry),
  });
  const workspaceSnapshot = async () => annotateMissingRoots(await dependencies.readRegistry());
  const projectRoot = async (projectId: string) => {
    const { registry } = await dependencies.readRegistry();
    return selectedProject(registry, projectId).rootPath;
  };

  ipc.handle("projects:list", () => workspaceSnapshot());
  ipc.handle("projects:add-folder", async () => {
    const rootPath = await dependencies.chooseDirectory();
    if (!rootPath) return null;
    const registry = await dependencies.projectService.registerManualFolder(rootPath, path.basename(rootPath));
    return projectForPath(registry, rootPath);
  });
  ipc.handle("projects:update", async (_event, projectId: unknown, patch: unknown) => {
    const id = nonEmptyString(projectId, "Project id");
    return selectedProject(await dependencies.projectService.updateProjectMetadata(id, validateProjectPatch(patch)), id);
  });
  ipc.handle("projects:remove", async (_event, projectId: unknown) => {
    const id = nonEmptyString(projectId, "Project id");
    // Sessions first: unregistering the folder before its sessions are torn down would strand
    // any surviving PTY with no UI left to reach it.
    await dependencies.coordinator.removeProjectSessions(id);
    await dependencies.projectService.removeProject(id);
    return workspaceSnapshot();
  });
  ipc.handle("projects:restore-backup", async () => {
    await dependencies.restoreRegistryBackup();
    return workspaceSnapshot();
  });
  ipc.handle("projects:relink", async (_event, projectId: unknown) => {
    const id = nonEmptyString(projectId, "Project id");
    const rootPath = await dependencies.chooseDirectory();
    if (!rootPath) return null;
    return selectedProject(await dependencies.projectService.relinkProject(id, rootPath), id);
  });
  ipc.handle("projects:reveal", async (_event, projectId: unknown) =>
    dependencies.projectActions.reveal(await projectRoot(nonEmptyString(projectId, "Project id"))),
  );
  ipc.handle("projects:open-editor", async (_event, projectId: unknown) =>
    dependencies.projectActions.openInEditor(await projectRoot(nonEmptyString(projectId, "Project id"))),
  );
  ipc.handle("projects:open-github", async (_event, projectId: unknown) =>
    dependencies.projectActions.openOnGitHub(await projectRoot(nonEmptyString(projectId, "Project id"))),
  );
  ipc.handle("projects:git-status", async (_event, projectId: unknown) =>
    dependencies.projectActions.gitStatus(await projectRoot(nonEmptyString(projectId, "Project id"))),
  );
  ipc.handle("projects:git-diff", async (_event, projectId: unknown) =>
    dependencies.projectActions.gitDiff(await projectRoot(nonEmptyString(projectId, "Project id"))),
  );

  const worktreePath = async (worktreeId: unknown) => {
    const id = nonEmptyString(worktreeId, "Worktree id");
    const worktree = await dependencies.worktrees.get(id);
    if (!worktree) throw new Error(`Unknown worktree: ${id}`);
    return worktree.path;
  };
  ipc.handle("worktrees:list", () => dependencies.worktrees.list());
  ipc.handle("worktrees:create", (_event, projectId: unknown, branch: unknown) =>
    dependencies.worktrees.create(nonEmptyString(projectId, "Project id"), nonEmptyString(branch, "Branch name")),
  );
  ipc.handle("worktrees:remove", (_event, worktreeId: unknown, force: unknown) => {
    if (typeof force !== "boolean") throw new Error("Worktree remove force flag must be a boolean");
    return dependencies.worktrees.remove(nonEmptyString(worktreeId, "Worktree id"), force);
  });
  ipc.handle("worktrees:reveal", async (_event, worktreeId: unknown) =>
    dependencies.projectActions.reveal(await worktreePath(worktreeId)),
  );
  ipc.handle("worktrees:open-editor", async (_event, worktreeId: unknown) =>
    dependencies.projectActions.openInEditor(await worktreePath(worktreeId)),
  );
  ipc.handle("worktrees:git-status", async (_event, worktreeId: unknown) =>
    dependencies.projectActions.gitStatus(await worktreePath(worktreeId)),
  );
  ipc.handle("worktrees:git-diff", async (_event, worktreeId: unknown) =>
    dependencies.projectActions.gitDiff(await worktreePath(worktreeId)),
  );

  const rootPathForTarget = (target: FileExplorerTarget) =>
    target.kind === "project" ? projectRoot(target.id) : worktreePath(target.id);
  ipc.handle("workspace-files:list-directory", async (_event, target: unknown, relativePath: unknown) =>
    dependencies.workspaceFiles.listDirectory(
      await rootPathForTarget(validateFileExplorerTarget(target)),
      relativePathString(relativePath),
    ),
  );
  ipc.handle("workspace-files:read-file", async (_event, target: unknown, relativePath: unknown) =>
    dependencies.workspaceFiles.readFile(
      await rootPathForTarget(validateFileExplorerTarget(target)),
      relativePathString(relativePath),
    ),
  );
  ipc.handle("workspace-files:write-file", async (_event, target: unknown, relativePath: unknown, content: unknown) => {
    if (typeof content !== "string") throw new Error("File content must be a string");
    return dependencies.workspaceFiles.writeFile(
      await rootPathForTarget(validateFileExplorerTarget(target)),
      relativePathString(relativePath),
      content,
    );
  });
  const gitRoot = (target: unknown) => rootPathForTarget(validateFileExplorerTarget(target));
  ipc.handle("git:panel-data", async (_event, target: unknown) => dependencies.git.panelData(await gitRoot(target)));
  ipc.handle("git:checkout", async (_event, target: unknown, branch: unknown) =>
    dependencies.git.checkout(await gitRoot(target), nonEmptyString(branch, "Branch name")),
  );
  ipc.handle("git:create-branch", async (_event, target: unknown, branch: unknown) =>
    dependencies.git.createBranch(await gitRoot(target), nonEmptyString(branch, "Branch name")),
  );
  ipc.handle("git:commit", async (_event, target: unknown, request: unknown) =>
    dependencies.git.commit(await gitRoot(target), validateGitCommitRequest(request)),
  );
  ipc.handle("git:push", async (_event, target: unknown) => dependencies.git.push(await gitRoot(target)));
  ipc.handle("git:fetch", async (_event, target: unknown) => dependencies.git.fetch(await gitRoot(target)));
  ipc.handle("git:pull", async (_event, target: unknown) => dependencies.git.pull(await gitRoot(target)));
  ipc.handle("git:file-original", async (_event, target: unknown, relativePath: unknown) =>
    dependencies.git.fileOriginal(await gitRoot(target), nonEmptyString(relativePath, "Relative path")),
  );
  ipc.handle("git-graph:open", async (_event, target: unknown, bounds: unknown) =>
    dependencies.gitGraph.open(await gitRoot(target), validateGitGraphBounds(bounds)),
  );
  ipc.handle("git-graph:set-bounds", (_event, bounds: unknown) =>
    dependencies.gitGraph.setBounds(validateGitGraphBounds(bounds)),
  );
  ipc.handle("git-graph:close", () => dependencies.gitGraph.close());

  ipc.handle("shell:open-external", async (_event, url: unknown) => dependencies.shell.openExternal(externalUrl(url)));
  // async so a bad-input throw reaches the renderer as a rejected invoke, matching every other handler.
  ipc.handle("clipboard:read-text", async () => dependencies.clipboard.readText());
  ipc.handle("clipboard:write-text", async (_event, text: unknown) => {
    if (typeof text !== "string") throw new Error("Clipboard text must be a string");
    dependencies.clipboard.writeText(text);
  });
  ipc.handle("workspace-files:run-executable", async (_event, target: unknown, relativePath: unknown) =>
    dependencies.workspaceFiles.runExecutable(
      await rootPathForTarget(validateFileExplorerTarget(target)),
      relativePathString(relativePath),
    ),
  );

  ipc.handle("providers:availability", () => dependencies.getAvailability());
  ipc.handle("agents:list", () => dependencies.listAgents());
  ipc.handle("agents:edit", () => dependencies.editAgents());
  ipc.handle("attention:state", () => dependencies.attentionState());
  ipc.handle("terminals:list", () => dependencies.coordinator.list());
  ipc.handle("terminals:state", () => dependencies.coordinator.state());
  ipc.handle("terminals:create", async (_event, input: unknown) => dependencies.coordinator.create(validateCreateInput(input)));
  ipc.handle("terminals:create-tool", async (_event, input: unknown) =>
    dependencies.coordinator.createTool(validateCreateToolInput(input)),
  );
  ipc.handle("terminals:attach", (_event, sessionId: unknown) =>
    dependencies.coordinator.attachForRenderer(nonEmptyString(sessionId, "Session id")),
  );
  ipc.handle("terminals:write", (_event, sessionId: unknown, data: unknown) => {
    if (typeof data !== "string") throw new Error("Terminal input must be a string");
    return dependencies.coordinator.write(nonEmptyString(sessionId, "Session id"), data);
  });
  ipc.handle("terminals:resize", (_event, sessionId: unknown, cols: unknown, rows: unknown) =>
    dependencies.coordinator.resize(
      nonEmptyString(sessionId, "Session id"),
      integer(cols, "Terminal columns"),
      integer(rows, "Terminal rows"),
    ),
  );
  ipc.handle("terminals:stop", (_event, sessionId: unknown) =>
    dependencies.coordinator.stop(nonEmptyString(sessionId, "Session id")),
  );
  ipc.handle("terminals:resume", (_event, input: unknown) => dependencies.coordinator.resume(validateResumeInput(input)));
  ipc.handle("terminals:remove", (_event, sessionId: unknown) =>
    dependencies.coordinator.remove(nonEmptyString(sessionId, "Session id")),
  );
  ipc.handle("terminals:rename", async (_event, sessionId: unknown, name: unknown) => {
    if (name !== null && typeof name !== "string") throw new Error("Session name must be a string or null");
    if (typeof name === "string" && name.length > 120) throw new Error("Session name is too long");
    return dependencies.coordinator.rename(nonEmptyString(sessionId, "Session id"), name);
  });
  ipc.handle("terminals:select", async (_event, projectId: unknown, sessionId: unknown) => {
    if (projectId !== null && typeof projectId !== "string") throw new Error("Selected project id is invalid");
    if (sessionId !== null && typeof sessionId !== "string") throw new Error("Selected session id is invalid");
    const snapshot = await dependencies.coordinator.select(projectId, sessionId);
    dependencies.onSessionSelected?.(sessionId);
    return snapshot;
  });
  ipc.handle("terminals:split", async (_event, sessionId: unknown) => {
    if (sessionId !== null && typeof sessionId !== "string") throw new Error("Split session id is invalid");
    const snapshot = await dependencies.coordinator.split(sessionId);
    // The split pane is on screen from this moment, so its unread badge clears like a selection.
    dependencies.onSessionSelected?.(sessionId);
    return snapshot;
  });
  ipc.handle("app:version", () => dependencies.appVersion());
  ipc.handle("updater:status", () => dependencies.updater.status());
  ipc.handle("updater:check", () => dependencies.updater.check());
  ipc.handle("updater:install", () => dependencies.updater.install());
  ipc.handle("app:open-releases", () => dependencies.updater.openReleases());
  ipc.handle("app:open-repository", () => dependencies.updater.openRepository());
}
