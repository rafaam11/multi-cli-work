import path from "node:path";
import type {
  AgentsSnapshot,
  CreateTerminalInput,
  CreateToolTerminalInput,
  GitStatusResult,
  ProjectMetadataPatch,
  ProviderAvailability,
  ResumeTerminalInput,
  SessionAttention,
  UpdaterStatus,
} from "../shared/api-types";
import type { ProjectRegistrySnapshot, ProjectRegistryV1, SharedProject } from "../shared/project-types";
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
  attach(sessionId: string): Promise<unknown>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  stop(sessionId: string): Promise<void>;
  resume(input: ResumeTerminalInput): Promise<unknown>;
  remove(sessionId: string): Promise<void>;
  removeProjectSessions(projectId: string): Promise<void>;
  rename(sessionId: string, name: string | null): Promise<unknown>;
  select(projectId: string | null, sessionId: string | null): Promise<unknown>;
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
}

interface MainIpcDependencies {
  projectService: ProjectServiceGateway;
  coordinator: TerminalCoordinatorGateway;
  updater: UpdaterGateway;
  projectActions: ProjectActionsGateway;
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
  const input = exactObject(value, ["projectId", "kind", "cols", "rows"], "Terminal create input");
  if (typeof input.kind !== "string" || !AGENT_ID_PATTERN.test(input.kind)) {
    throw new Error("Terminal kind is invalid");
  }
  return {
    projectId: nonEmptyString(input.projectId, "Project id"),
    kind: input.kind,
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
    dependencies.coordinator.attach(nonEmptyString(sessionId, "Session id")),
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
  ipc.handle("app:version", () => dependencies.appVersion());
  ipc.handle("updater:status", () => dependencies.updater.status());
  ipc.handle("updater:check", () => dependencies.updater.check());
  ipc.handle("updater:install", () => dependencies.updater.install());
  ipc.handle("app:open-releases", () => dependencies.updater.openReleases());
  ipc.handle("app:open-repository", () => dependencies.updater.openRepository());
}
