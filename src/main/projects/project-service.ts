import fs from "node:fs/promises";
import path from "node:path";
import type { ProjectRegistryV1, ProjectStatus, ProjectTrack, SharedProject } from "../../shared/project-types";
import {
  normalizeProjectPath,
  parseProjectRegistry,
  removeProjectFromRegistry,
  updateProjectRegistry,
  upsertManualProject,
} from "./project-registry";

const METADATA_KEYS = ["displayName", "status", "memo", "tracks", "hidden", "order"] as const;

type RegistryUpdater = typeof updateProjectRegistry;

export interface ProjectMetadataUpdate {
  displayName?: string | null;
  status?: ProjectStatus | null;
  memo?: string;
  tracks?: ProjectTrack[];
  hidden?: boolean;
  order?: number | null;
}

export interface ProjectServiceOptions {
  registryPath?: string;
  platform?: NodeJS.Platform;
  now?: () => string;
  idFactory?: () => string;
  registryUpdater?: RegistryUpdater;
}

export class ProjectServiceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectServiceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateDisplayName(displayName: unknown): asserts displayName is string | null | undefined {
  if (displayName !== undefined && displayName !== null && typeof displayName !== "string") {
    throw new ProjectServiceError("Project display name must be a string or null");
  }
}

function validateMetadataUpdate(update: unknown): asserts update is ProjectMetadataUpdate {
  if (!isRecord(update)) throw new ProjectServiceError("Project metadata update must be an object");
  const unknownKeys = Object.keys(update).filter((key) => !METADATA_KEYS.includes(key as (typeof METADATA_KEYS)[number]));
  if (unknownKeys.length > 0) {
    throw new ProjectServiceError(`Project metadata update contains unknown fields: ${unknownKeys.join(", ")}`);
  }
}

function updateMetadataProject(project: SharedProject, update: ProjectMetadataUpdate, now: string): SharedProject {
  const next = { ...project, updatedAt: now };
  for (const key of METADATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(update, key) && update[key] !== undefined) {
      Object.assign(next, { [key]: update[key] });
    }
  }
  return next;
}

export class ProjectService {
  private readonly options: ProjectServiceOptions;

  constructor(options: ProjectServiceOptions = {}) {
    this.options = options;
  }

  async findMissingProjectRoots(registry: ProjectRegistryV1): Promise<string[]> {
    const checks = await Promise.all(
      Object.values(registry.projects).map(async (project) => {
        try {
          return (await fs.stat(project.rootPath)).isDirectory() ? null : project.id;
        } catch {
          return project.id;
        }
      }),
    );
    return checks.filter((projectId): projectId is string => projectId !== null);
  }

  async registerManualFolder(rootPath: string, displayName?: string | null): Promise<ProjectRegistryV1> {
    validateDisplayName(displayName);
    const validatedPath = await this.validateDirectory(rootPath);
    const now = this.now();
    return this.updateRegistry((registry) =>
      upsertManualProject(
        registry,
        { rootPath: validatedPath, ...(displayName !== undefined ? { displayName } : {}) },
        { now, idFactory: this.options.idFactory, platform: this.options.platform },
      ),
    );
  }

  async removeProject(projectId: string): Promise<ProjectRegistryV1> {
    const now = this.now();
    return this.updateRegistry((registry) => {
      if (!registry.projects[projectId]) throw new ProjectServiceError(`Project ${projectId} was not found`);
      return removeProjectFromRegistry(registry, projectId, now);
    });
  }

  async updateProjectMetadata(projectId: string, update: ProjectMetadataUpdate): Promise<ProjectRegistryV1> {
    validateMetadataUpdate(update);
    const now = this.now();
    return this.updateRegistry((registry) => {
      const project = registry.projects[projectId];
      if (!project) throw new ProjectServiceError(`Project ${projectId} was not found`);
      const next: ProjectRegistryV1 = {
        ...registry,
        updatedAt: now,
        projects: { ...registry.projects, [projectId]: updateMetadataProject(project, update, now) },
      };
      try {
        return parseProjectRegistry(next);
      } catch (error) {
        throw new ProjectServiceError("Project metadata update is invalid", { cause: error });
      }
    });
  }

  async relinkProject(projectId: string, rootPath: string): Promise<ProjectRegistryV1> {
    const validatedPath = await this.validateDirectory(rootPath);
    const normalizedTarget = normalizeProjectPath(validatedPath, this.options.platform);
    const now = this.now();
    return this.updateRegistry((registry) => {
      const project = registry.projects[projectId];
      if (!project) throw new ProjectServiceError(`Project ${projectId} was not found`);
      const collision = Object.values(registry.projects).find(
        (candidate) =>
          candidate.id !== projectId && normalizeProjectPath(candidate.rootPath, this.options.platform) === normalizedTarget,
      );
      if (collision) throw new ProjectServiceError(`Folder is already registered by project ${collision.id}`);
      return {
        ...registry,
        updatedAt: now,
        projects: {
          ...registry.projects,
          [projectId]: {
            ...project,
            rootPath: validatedPath,
            sources: project.sources.includes("manual") ? project.sources : ["manual", ...project.sources],
            updatedAt: now,
          },
        },
      };
    });
  }

  private now(): string {
    return (this.options.now ?? (() => new Date().toISOString()))();
  }

  private updateRegistry(update: Parameters<RegistryUpdater>[0]): Promise<ProjectRegistryV1> {
    const registryUpdater = this.options.registryUpdater ?? updateProjectRegistry;
    return registryUpdater(update, { registryPath: this.options.registryPath });
  }

  private async validateDirectory(rootPath: string): Promise<string> {
    if (typeof rootPath !== "string" || rootPath.trim().length === 0 || !path.isAbsolute(rootPath)) {
      throw new ProjectServiceError("Project path must be a non-empty absolute path");
    }
    const resolvedPath = path.resolve(rootPath);
    try {
      if (!(await fs.stat(resolvedPath)).isDirectory()) throw new Error("not a directory");
    } catch (error) {
      throw new ProjectServiceError(`Project path must reference an existing directory: ${resolvedPath}`, { cause: error });
    }
    return resolvedPath;
  }
}
