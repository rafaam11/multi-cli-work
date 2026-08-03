import os from "node:os";
import path from "node:path";
import type { ProjectStatus } from "../../shared/project-types";
import type {
  WorkProject,
  WorkProjectMember,
  WorkProjectRegistryV1,
  WorkProjectRole,
} from "../../shared/work-project-types";
import {
  type JsonStoreSpec,
  readJsonStore,
  restoreJsonStoreBackup,
  updateJsonStore,
} from "../storage/json-store";

export const WORK_PROJECT_REGISTRY_PATH = path.join(os.homedir(), ".multi-cli-work", "work-projects.json");

const STATUSES: readonly ProjectStatus[] = ["진행중", "보류", "완료", "보관"];
const ROLES: readonly WorkProjectRole[] = ["repo", "docs"];
const WORK_PROJECT_KEYS = [
  "id",
  "name",
  "category",
  "status",
  "memo",
  "notionUrl",
  "members",
  "order",
  "createdAt",
  "updatedAt",
] as const;
const MEMBER_KEYS = ["projectId", "role"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class WorkProjectRegistryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkProjectRegistryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new WorkProjectRegistryError(`${label} contains unknown fields: ${unknown.join(", ")}`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WorkProjectRegistryError(`${label} must be a non-empty string`);
  }
  return value;
}

function plainString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new WorkProjectRegistryError(`${label} must be a string`);
  return value;
}

function uuidString(value: unknown, label: string): string {
  const raw = requiredString(value, label);
  if (!UUID_PATTERN.test(raw)) throw new WorkProjectRegistryError(`${label} must be a UUID`);
  return raw;
}

function isoString(value: unknown, label: string): string {
  const raw = requiredString(value, label);
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new WorkProjectRegistryError(`${label} must be an ISO timestamp`);
  return new Date(parsed).toISOString();
}

function parseMembers(value: unknown, key: string): WorkProjectMember[] {
  if (!Array.isArray(value)) throw new WorkProjectRegistryError(`work project ${key}.members must be an array`);
  const members = value.map((member, index) => {
    if (!isRecord(member)) {
      throw new WorkProjectRegistryError(`work project ${key}.members[${index}] must be an object`);
    }
    assertExactKeys(member, MEMBER_KEYS, `work project ${key}.members[${index}]`);
    if (!ROLES.includes(member.role as WorkProjectRole)) {
      throw new WorkProjectRegistryError(`work project ${key}.members[${index}].role is invalid`);
    }
    return {
      projectId: requiredString(member.projectId, `work project ${key}.members[${index}].projectId`),
      role: member.role as WorkProjectRole,
    };
  });
  const unique = new Set(members.map((member) => member.projectId));
  if (unique.size !== members.length) {
    throw new WorkProjectRegistryError(`work project ${key}.members contains duplicate projectIds`);
  }
  return members;
}

function parseWorkProject(value: unknown, key: string): WorkProject {
  if (!isRecord(value)) throw new WorkProjectRegistryError(`work project ${key} must be an object`);
  assertExactKeys(value, WORK_PROJECT_KEYS, `work project ${key}`);
  const id = uuidString(value.id, `work project ${key}.id`);
  if (id !== key) throw new WorkProjectRegistryError(`Work project key ${key} does not match id ${id}`);
  if (value.status !== null && !STATUSES.includes(value.status as ProjectStatus)) {
    throw new WorkProjectRegistryError(`work project ${key}.status is invalid`);
  }
  if (value.notionUrl !== null && (typeof value.notionUrl !== "string" || value.notionUrl.length === 0)) {
    throw new WorkProjectRegistryError(`work project ${key}.notionUrl must be a non-empty string or null`);
  }
  if (value.order !== null && (!Number.isInteger(value.order) || (value.order as number) < 0)) {
    throw new WorkProjectRegistryError(`work project ${key}.order must be a non-negative integer or null`);
  }
  return {
    id,
    name: requiredString(value.name, `work project ${key}.name`),
    category: requiredString(value.category, `work project ${key}.category`),
    status: value.status as ProjectStatus | null,
    memo: plainString(value.memo, `work project ${key}.memo`),
    notionUrl: value.notionUrl,
    members: parseMembers(value.members, key),
    order: value.order as number | null,
    createdAt: isoString(value.createdAt, `work project ${key}.createdAt`),
    updatedAt: isoString(value.updatedAt, `work project ${key}.updatedAt`),
  };
}

export function parseWorkProjectRegistry(value: unknown): WorkProjectRegistryV1 {
  if (!isRecord(value)) throw new WorkProjectRegistryError("Work project registry must be an object");
  assertExactKeys(value, ["schemaVersion", "updatedAt", "teamsSyncRoot", "workProjects"], "Work project registry");
  if (value.schemaVersion !== 1) {
    throw new WorkProjectRegistryError(`Unsupported work project registry schema: ${String(value.schemaVersion)}`);
  }
  // Absent in hand-edited files reads as "not configured"; the writer always records the key.
  if (value.teamsSyncRoot !== undefined && value.teamsSyncRoot !== null && (typeof value.teamsSyncRoot !== "string" || value.teamsSyncRoot.length === 0)) {
    throw new WorkProjectRegistryError("Work project registry teamsSyncRoot must be a non-empty string or null");
  }
  if (!isRecord(value.workProjects)) {
    throw new WorkProjectRegistryError("Work project registry workProjects must be an object");
  }
  const workProjects = Object.fromEntries(
    Object.entries(value.workProjects).map(([key, workProject]) => [key, parseWorkProject(workProject, key)]),
  );
  // A folder belongs to at most one work project — membership is the single source of truth here,
  // so cross-project duplicates would make the sidebar grouping ambiguous.
  const owners = new Map<string, string>();
  for (const workProject of Object.values(workProjects)) {
    for (const member of workProject.members) {
      const owner = owners.get(member.projectId);
      if (owner && owner !== workProject.id) {
        throw new WorkProjectRegistryError(
          `Work projects ${owner} and ${workProject.id} both claim project ${member.projectId}`,
        );
      }
      owners.set(member.projectId, workProject.id);
    }
  }
  return {
    schemaVersion: 1,
    updatedAt: isoString(value.updatedAt, "Work project registry updatedAt"),
    teamsSyncRoot: (value.teamsSyncRoot as string | null | undefined) ?? null,
    workProjects,
  };
}

export function emptyWorkProjectRegistry(now = new Date().toISOString()): WorkProjectRegistryV1 {
  return { schemaVersion: 1, updatedAt: now, teamsSyncRoot: null, workProjects: {} };
}

const STORE: JsonStoreSpec<WorkProjectRegistryV1> = {
  label: "work project registry",
  parse: parseWorkProjectRegistry,
  empty: () => emptyWorkProjectRegistry(),
  error: (message, options) => new WorkProjectRegistryError(message, options),
  isContentError: (error) => error instanceof WorkProjectRegistryError,
};

export interface WorkProjectRegistryOptions {
  registryPath?: string;
  lockRetryMs?: number;
}

function registryPathOf(options: WorkProjectRegistryOptions): string {
  return options.registryPath ?? WORK_PROJECT_REGISTRY_PATH;
}

export async function readWorkProjectRegistry(
  options: WorkProjectRegistryOptions = {},
): Promise<WorkProjectRegistryV1> {
  return (await readJsonStore(STORE, registryPathOf(options))).value;
}

export async function updateWorkProjectRegistry(
  update: (registry: WorkProjectRegistryV1) => WorkProjectRegistryV1 | Promise<WorkProjectRegistryV1>,
  options: WorkProjectRegistryOptions = {},
): Promise<WorkProjectRegistryV1> {
  return updateJsonStore(STORE, registryPathOf(options), update, {
    ...(options.lockRetryMs !== undefined ? { lockRetryMs: options.lockRetryMs } : {}),
  });
}

export async function restoreWorkProjectRegistryFromBackup(
  options: WorkProjectRegistryOptions = {},
): Promise<WorkProjectRegistryV1> {
  return restoreJsonStoreBackup(STORE, registryPathOf(options), {
    ...(options.lockRetryMs !== undefined ? { lockRetryMs: options.lockRetryMs } : {}),
  });
}
