import { randomUUID } from "node:crypto";
import type { ProjectStatus } from "../../shared/project-types";
import type {
  WorkProject,
  WorkProjectNotionLink,
  WorkProjectRegistryV1,
  WorkProjectRole,
} from "../../shared/work-project-types";
import { updateWorkProjectRegistry } from "./work-project-registry";

const METADATA_KEYS = ["name", "category", "status", "memo", "notionLinks", "order"] as const;

type RegistryUpdater = typeof updateWorkProjectRegistry;

export interface WorkProjectMetadataUpdate {
  name?: string;
  category?: string;
  status?: ProjectStatus | null;
  memo?: string;
  notionLinks?: WorkProjectNotionLink[];
  order?: number | null;
}

export interface WorkProjectServiceOptions {
  registryPath?: string;
  now?: () => string;
  idFactory?: () => string;
  registryUpdater?: RegistryUpdater;
}

export class WorkProjectServiceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkProjectServiceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateMetadataUpdate(update: unknown): asserts update is WorkProjectMetadataUpdate {
  if (!isRecord(update)) throw new WorkProjectServiceError("Work project update must be an object");
  const unknownKeys = Object.keys(update).filter(
    (key) => !METADATA_KEYS.includes(key as (typeof METADATA_KEYS)[number]),
  );
  if (unknownKeys.length > 0) {
    throw new WorkProjectServiceError(`Work project update contains unknown fields: ${unknownKeys.join(", ")}`);
  }
}

/**
 * The UI hands over its rows as-is, drafts included: trim each row, drop the ones without a URL,
 * and give unlabeled rows the plain "노션" label the registry requires.
 */
function normalizeNotionLinks(links: WorkProjectNotionLink[] | undefined): WorkProjectNotionLink[] | undefined {
  if (links === undefined) return undefined;
  if (!Array.isArray(links)) throw new WorkProjectServiceError("Work project notionLinks must be an array");
  return links
    .map((link) => ({ label: String(link?.label ?? "").trim(), url: String(link?.url ?? "").trim() }))
    .filter((link) => link.url.length > 0)
    .map((link) => ({ label: link.label.length === 0 ? "노션" : link.label, url: link.url }));
}

export class WorkProjectService {
  private readonly options: WorkProjectServiceOptions;

  constructor(options: WorkProjectServiceOptions = {}) {
    this.options = options;
  }

  async createWorkProject(input: { name: string; category?: string }): Promise<WorkProjectRegistryV1> {
    if (typeof input?.name !== "string" || input.name.trim().length === 0) {
      throw new WorkProjectServiceError("Work project name must be a non-empty string");
    }
    const category = input.category === undefined ? "기타" : input.category;
    if (typeof category !== "string" || category.trim().length === 0) {
      throw new WorkProjectServiceError("Work project category must be a non-empty string");
    }
    const now = this.now();
    const workProject: WorkProject = {
      id: (this.options.idFactory ?? randomUUID)(),
      name: input.name.trim(),
      category: category.trim(),
      status: null,
      memo: "",
      notionLinks: [],
      members: [],
      order: null,
      createdAt: now,
      updatedAt: now,
    };
    return this.updateRegistry((registry) => ({
      ...registry,
      updatedAt: now,
      workProjects: { ...registry.workProjects, [workProject.id]: workProject },
    }));
  }

  async updateWorkProjectMetadata(
    workProjectId: string,
    update: WorkProjectMetadataUpdate,
  ): Promise<WorkProjectRegistryV1> {
    validateMetadataUpdate(update);
    const now = this.now();
    return this.updateRegistry((registry) => {
      const workProject = this.require(registry, workProjectId);
      const next = { ...workProject, updatedAt: now };
      for (const key of METADATA_KEYS) {
        if (Object.prototype.hasOwnProperty.call(update, key) && update[key] !== undefined) {
          Object.assign(next, { [key]: key === "notionLinks" ? normalizeNotionLinks(update.notionLinks) : update[key] });
        }
      }
      return {
        ...registry,
        updatedAt: now,
        workProjects: { ...registry.workProjects, [workProjectId]: next },
      };
    });
  }

  async removeWorkProject(workProjectId: string): Promise<WorkProjectRegistryV1> {
    const now = this.now();
    return this.updateRegistry((registry) => {
      this.require(registry, workProjectId);
      const workProjects = { ...registry.workProjects };
      delete workProjects[workProjectId];
      return { ...registry, updatedAt: now, workProjects };
    });
  }

  /**
   * Adds a folder to a work project. A folder belongs to at most one work project, so adding it
   * while it is a member elsewhere moves it — the sidebar drag/context-menu semantics — rather than
   * failing and making the caller orchestrate a remove first.
   */
  async addMember(workProjectId: string, projectId: string, role: WorkProjectRole): Promise<WorkProjectRegistryV1> {
    if (typeof projectId !== "string" || projectId.length === 0) {
      throw new WorkProjectServiceError("Member projectId must be a non-empty string");
    }
    if (role !== "repo" && role !== "docs") {
      throw new WorkProjectServiceError("Member role must be 'repo' or 'docs'");
    }
    const now = this.now();
    return this.updateRegistry((registry) => {
      this.require(registry, workProjectId);
      const workProjects = Object.fromEntries(
        Object.entries(registry.workProjects).map(([id, workProject]) => {
          const withoutMember = workProject.members.filter((member) => member.projectId !== projectId);
          if (id === workProjectId) {
            return [id, { ...workProject, members: [...withoutMember, { projectId, role }], updatedAt: now }];
          }
          if (withoutMember.length !== workProject.members.length) {
            return [id, { ...workProject, members: withoutMember, updatedAt: now }];
          }
          return [id, workProject];
        }),
      );
      return { ...registry, updatedAt: now, workProjects };
    });
  }

  async removeMember(workProjectId: string, projectId: string): Promise<WorkProjectRegistryV1> {
    const now = this.now();
    return this.updateRegistry((registry) => {
      const workProject = this.require(registry, workProjectId);
      if (!workProject.members.some((member) => member.projectId === projectId)) {
        throw new WorkProjectServiceError(`Project ${projectId} is not a member of work project ${workProjectId}`);
      }
      return {
        ...registry,
        updatedAt: now,
        workProjects: {
          ...registry.workProjects,
          [workProjectId]: {
            ...workProject,
            members: workProject.members.filter((member) => member.projectId !== projectId),
            updatedAt: now,
          },
        },
      };
    });
  }

  /**
   * Drops every membership referencing a folder project that no longer exists — called after a
   * folder is removed from the project registry so work projects do not accumulate dangling members.
   */
  async removeProjectReferences(projectId: string): Promise<WorkProjectRegistryV1> {
    const now = this.now();
    return this.updateRegistry((registry) => {
      let changed = false;
      const workProjects = Object.fromEntries(
        Object.entries(registry.workProjects).map(([id, workProject]) => {
          const members = workProject.members.filter((member) => member.projectId !== projectId);
          if (members.length === workProject.members.length) return [id, workProject];
          changed = true;
          return [id, { ...workProject, members, updatedAt: now }];
        }),
      );
      if (!changed) return registry;
      return { ...registry, updatedAt: now, workProjects };
    });
  }

  /** Mirrors `ProjectService.reorderProjects`: one transaction, unlisted ids keep relative order. */
  async reorderWorkProjects(orderedIds: readonly string[]): Promise<WorkProjectRegistryV1> {
    if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== "string" || id.length === 0)) {
      throw new WorkProjectServiceError("Work project order must be a list of work project ids");
    }
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new WorkProjectServiceError("Work project order contains duplicate ids");
    }
    const now = this.now();
    return this.updateRegistry((registry) => {
      const unknown = orderedIds.filter((id) => !registry.workProjects[id]);
      if (unknown.length > 0) {
        throw new WorkProjectServiceError(`Work project order references unknown work projects: ${unknown.join(", ")}`);
      }
      const listed = new Set(orderedIds);
      const trailing = Object.values(registry.workProjects)
        .filter((workProject) => !listed.has(workProject.id))
        .sort(
          (left, right) =>
            (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
            left.id.localeCompare(right.id),
        )
        .map((workProject) => workProject.id);
      const workProjects = { ...registry.workProjects };
      [...orderedIds, ...trailing].forEach((id, index) => {
        const workProject = workProjects[id];
        if (workProject.order === index) return;
        workProjects[id] = { ...workProject, order: index, updatedAt: now };
      });
      return { ...registry, updatedAt: now, workProjects };
    });
  }

  /** `null` clears the setting; a path must be absolute — the folder dialog is the usual source. */
  async setTeamsSyncRoot(rootPath: string | null): Promise<WorkProjectRegistryV1> {
    if (rootPath !== null && (typeof rootPath !== "string" || rootPath.trim().length === 0)) {
      throw new WorkProjectServiceError("Teams sync root must be a non-empty string or null");
    }
    const now = this.now();
    return this.updateRegistry((registry) => ({ ...registry, updatedAt: now, teamsSyncRoot: rootPath }));
  }

  private now(): string {
    return (this.options.now ?? (() => new Date().toISOString()))();
  }

  private require(registry: WorkProjectRegistryV1, workProjectId: string): WorkProject {
    const workProject = registry.workProjects[workProjectId];
    if (!workProject) throw new WorkProjectServiceError(`Work project ${workProjectId} was not found`);
    return workProject;
  }

  private updateRegistry(update: Parameters<RegistryUpdater>[0]): Promise<WorkProjectRegistryV1> {
    const registryUpdater = this.options.registryUpdater ?? updateWorkProjectRegistry;
    return registryUpdater(update, { registryPath: this.options.registryPath });
  }
}
