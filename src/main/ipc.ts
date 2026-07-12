import path from "node:path";
import type {
  CreateTerminalInput,
  ProjectMetadataPatch,
  ProviderAvailability,
  ResumeTerminalInput,
} from "../shared/api-types";
import type { ProjectRegistrySnapshot, ProjectRegistryV1, SharedProject } from "../shared/project-types";
import type { ProjectMetadataUpdate } from "./projects/project-service";

export interface IpcRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void;
}

interface ProjectServiceGateway {
  discoverAndReconcile(): Promise<ProjectRegistryV1>;
  findMissingProjectRoots(registry: ProjectRegistryV1): Promise<string[]>;
  registerManualFolder(rootPath: string, displayName?: string | null): Promise<ProjectRegistryV1>;
  updateProjectMetadata(projectId: string, update: ProjectMetadataUpdate): Promise<ProjectRegistryV1>;
  relinkProject(projectId: string, rootPath: string): Promise<ProjectRegistryV1>;
}

interface TerminalCoordinatorGateway {
  list(): unknown;
  state(): Promise<unknown>;
  create(input: CreateTerminalInput): Promise<unknown>;
  attach(sessionId: string): Promise<unknown>;
  write(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  stop(sessionId: string): Promise<void>;
  resume(input: ResumeTerminalInput): Promise<unknown>;
  remove(sessionId: string): Promise<void>;
  select(projectId: string | null, sessionId: string | null): Promise<unknown>;
}

interface MainIpcDependencies {
  projectService: ProjectServiceGateway;
  coordinator: TerminalCoordinatorGateway;
  readRegistry(): Promise<ProjectRegistrySnapshot>;
  restoreRegistryBackup(): Promise<void>;
  chooseDirectory(): Promise<string | null>;
  getAvailability(): Promise<ProviderAvailability>;
}

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

function validateCreateInput(value: unknown): CreateTerminalInput {
  const input = exactObject(value, ["projectId", "kind", "cols", "rows"], "Terminal create input");
  if (input.kind !== "powershell" && input.kind !== "claude" && input.kind !== "codex") {
    throw new Error("Terminal kind is invalid");
  }
  return {
    projectId: nonEmptyString(input.projectId, "Project id"),
    kind: input.kind,
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
  const patch = exactObject(value, ["displayName", "status", "memo", "hidden", "order"], "Project metadata patch");
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
  ipc.handle("projects:list", async () => annotateMissingRoots(await dependencies.readRegistry()));
  ipc.handle("projects:refresh", async () =>
    annotateMissingRoots({
      registry: await dependencies.projectService.discoverAndReconcile(),
      source: "primary" as const,
      writable: true,
    }),
  );
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
  ipc.handle("projects:restore-backup", async () => {
    await dependencies.restoreRegistryBackup();
    return annotateMissingRoots(await dependencies.readRegistry());
  });
  ipc.handle("projects:relink", async (_event, projectId: unknown) => {
    const id = nonEmptyString(projectId, "Project id");
    const rootPath = await dependencies.chooseDirectory();
    if (!rootPath) return null;
    return selectedProject(await dependencies.projectService.relinkProject(id, rootPath), id);
  });
  ipc.handle("providers:availability", () => dependencies.getAvailability());
  ipc.handle("terminals:list", () => dependencies.coordinator.list());
  ipc.handle("terminals:state", () => dependencies.coordinator.state());
  ipc.handle("terminals:create", async (_event, input: unknown) => dependencies.coordinator.create(validateCreateInput(input)));
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
  ipc.handle("terminals:select", (_event, projectId: unknown, sessionId: unknown) => {
    if (projectId !== null && typeof projectId !== "string") throw new Error("Selected project id is invalid");
    if (sessionId !== null && typeof sessionId !== "string") throw new Error("Selected session id is invalid");
    return dependencies.coordinator.select(projectId, sessionId);
  });
}
