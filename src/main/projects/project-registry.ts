import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import type {
  ProjectRegistrySnapshot,
  ProjectRegistryV1,
  ProjectSource,
  ProjectStatus,
  ProjectTrack,
  SharedProject,
} from "../../shared/project-types";
import {
  type JsonStoreSpec,
  readJsonStore,
  restoreJsonStoreBackup,
  updateJsonStore,
} from "../storage/json-store";

const SOURCES: readonly ProjectSource[] = ["manual", "claude", "codex"];
const STATUSES: readonly ProjectStatus[] = ["진행중", "보류", "완료", "보관"];
const PROJECT_KEYS = [
  "id",
  "rootPath",
  "displayName",
  "sources",
  "providerRefs",
  "status",
  "memo",
  "tracks",
  "hidden",
  "order",
  "createdAt",
  "updatedAt",
] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PROJECT_REGISTRY_PATH = path.join(os.homedir(), ".multi-cli-work", "projects.json");

export class ProjectRegistryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProjectRegistryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new ProjectRegistryError(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new ProjectRegistryError(`${label} must be a non-empty string`);
  return value;
}

function plainString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new ProjectRegistryError(`${label} must be a string`);
  return value;
}

function uuidString(value: unknown, label: string): string {
  const raw = requiredString(value, label);
  if (!UUID_PATTERN.test(raw)) throw new ProjectRegistryError(`${label} must be a UUID`);
  return raw;
}

function isoString(value: unknown, label: string): string {
  const raw = requiredString(value, label);
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) throw new ProjectRegistryError(`${label} must be an ISO timestamp`);
  return new Date(parsed).toISOString();
}

function uniqueStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new ProjectRegistryError(`${label} must be a string array`);
  }
  const unique = [...new Set(value)];
  if (unique.length !== value.length) throw new ProjectRegistryError(`${label} contains duplicate values`);
  return unique;
}

function parseTracks(value: unknown): ProjectTrack[] {
  if (!Array.isArray(value)) throw new ProjectRegistryError("tracks must be an array");
  return value.map((track, trackIndex) => {
    if (!isRecord(track)) throw new ProjectRegistryError(`tracks[${trackIndex}] must be an object`);
    assertExactKeys(track, ["id", "title", "items"], `tracks[${trackIndex}]`);
    if (!Array.isArray(track.items)) throw new ProjectRegistryError(`tracks[${trackIndex}].items must be an array`);
    return {
      id: requiredString(track.id, `tracks[${trackIndex}].id`),
      title: plainString(track.title, `tracks[${trackIndex}].title`),
      items: track.items.map((item, itemIndex) => {
        if (!isRecord(item)) throw new ProjectRegistryError(`tracks[${trackIndex}].items[${itemIndex}] must be an object`);
        assertExactKeys(item, ["id", "text", "done"], `tracks[${trackIndex}].items[${itemIndex}]`);
        if (typeof item.done !== "boolean") throw new ProjectRegistryError(`tracks[${trackIndex}].items[${itemIndex}].done must be boolean`);
        return {
          id: requiredString(item.id, `tracks[${trackIndex}].items[${itemIndex}].id`),
          text: plainString(item.text, `tracks[${trackIndex}].items[${itemIndex}].text`),
          done: item.done,
        };
      }),
    };
  });
}

function parseProject(value: unknown, key: string): SharedProject {
  if (!isRecord(value)) throw new ProjectRegistryError(`project ${key} must be an object`);
  assertExactKeys(value, PROJECT_KEYS, `project ${key}`);
  const id = uuidString(value.id, `project ${key}.id`);
  if (id !== key) throw new ProjectRegistryError(`Project key ${key} does not match project id ${id}`);
  if (!Array.isArray(value.sources) || value.sources.some((source) => !SOURCES.includes(source as ProjectSource))) {
    throw new ProjectRegistryError(`project ${key}.sources is invalid`);
  }
  if (value.sources.length === 0) {
    throw new ProjectRegistryError(`project ${key}.sources must not be empty`);
  }
  if (new Set(value.sources).size !== value.sources.length) {
    throw new ProjectRegistryError(`project ${key}.sources contains duplicate values`);
  }
  if (!isRecord(value.providerRefs)) throw new ProjectRegistryError(`project ${key}.providerRefs must be an object`);
  assertExactKeys(value.providerRefs, ["claude", "codex"], `project ${key}.providerRefs`);
  const sources = SOURCES.filter((source) => (value.sources as unknown[]).includes(source));
  const providerRefs = {
    claude: uniqueStringArray(value.providerRefs.claude, `project ${key}.providerRefs.claude`),
    codex: uniqueStringArray(value.providerRefs.codex, `project ${key}.providerRefs.codex`),
  };
  if (providerRefs.claude.some((providerRef) => providerRef.includes(":"))) {
    throw new ProjectRegistryError(`project ${key} has an invalid Claude provider ref`);
  }
  if (providerRefs.codex.some((providerRef) => !/^codex:.+/.test(providerRef))) {
    throw new ProjectRegistryError(`project ${key} has an invalid Codex provider ref`);
  }
  if (providerRefs.claude.length > 0 && !sources.includes("claude")) {
    throw new ProjectRegistryError(`project ${key} has Claude provider refs without the Claude source`);
  }
  if (providerRefs.codex.length > 0 && !sources.includes("codex")) {
    throw new ProjectRegistryError(`project ${key} has Codex provider refs without the Codex source`);
  }
  if (value.displayName !== null && typeof value.displayName !== "string") {
    throw new ProjectRegistryError(`project ${key}.displayName must be string or null`);
  }
  if (value.status !== null && !STATUSES.includes(value.status as ProjectStatus)) {
    throw new ProjectRegistryError(`project ${key}.status is invalid`);
  }
  if (typeof value.memo !== "string" || typeof value.hidden !== "boolean") {
    throw new ProjectRegistryError(`project ${key} metadata is invalid`);
  }
  if (value.order !== null && (!Number.isInteger(value.order) || (value.order as number) < 0)) {
    throw new ProjectRegistryError(`project ${key}.order must be a non-negative integer or null`);
  }
  return {
    id,
    rootPath: requiredString(value.rootPath, `project ${key}.rootPath`),
    displayName: value.displayName,
    sources,
    providerRefs,
    status: value.status as ProjectStatus | null,
    memo: value.memo,
    tracks: parseTracks(value.tracks),
    hidden: value.hidden,
    order: value.order as number | null,
    createdAt: isoString(value.createdAt, `project ${key}.createdAt`),
    updatedAt: isoString(value.updatedAt, `project ${key}.updatedAt`),
  };
}

export function parseProjectRegistry(value: unknown): ProjectRegistryV1 {
  if (!isRecord(value)) throw new ProjectRegistryError("Project registry must be an object");
  assertExactKeys(value, ["schemaVersion", "updatedAt", "migratedFromBoardAt", "projects"], "Project registry");
  if (value.schemaVersion !== 1) throw new ProjectRegistryError(`Unsupported project registry schema: ${String(value.schemaVersion)}`);
  if (!isRecord(value.projects)) throw new ProjectRegistryError("Project registry projects must be an object");
  const projects = Object.fromEntries(Object.entries(value.projects).map(([key, project]) => [key, parseProject(project, key)]));
  const rootOwners = new Map<string, string>();
  const refOwners = new Map<string, string>();
  for (const project of Object.values(projects)) {
    const root = normalizeProjectPath(project.rootPath);
    const rootOwner = rootOwners.get(root);
    if (rootOwner && rootOwner !== project.id) {
      throw new ProjectRegistryError(`Projects ${rootOwner} and ${project.id} have duplicate normalized roots`);
    }
    rootOwners.set(root, project.id);
    for (const kind of ["claude", "codex"] as const) {
      for (const providerRef of project.providerRefs[kind]) {
        const key = `${kind}:${providerRef}`;
        const refOwner = refOwners.get(key);
        if (refOwner && refOwner !== project.id) {
          throw new ProjectRegistryError(`Projects ${refOwner} and ${project.id} have duplicate provider refs`);
        }
        refOwners.set(key, project.id);
      }
    }
  }
  const registry: ProjectRegistryV1 = {
    schemaVersion: 1,
    updatedAt: isoString(value.updatedAt, "Project registry updatedAt"),
    projects,
  };
  if (value.migratedFromBoardAt !== undefined) {
    registry.migratedFromBoardAt = isoString(value.migratedFromBoardAt, "Project registry migratedFromBoardAt");
  }
  return registry;
}

export function emptyProjectRegistry(now = new Date().toISOString()): ProjectRegistryV1 {
  return { schemaVersion: 1, updatedAt: now, projects: {} };
}

export function normalizeProjectPath(rootPath: string, platform: NodeJS.Platform = process.platform): string {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  let normalized = pathApi.normalize(pathApi.resolve(rootPath));
  const parsed = pathApi.parse(normalized);
  while (normalized.length > parsed.root.length && normalized.endsWith(pathApi.sep)) normalized = normalized.slice(0, -1);
  if (platform === "win32") {
    normalized = normalized.replaceAll("/", "\\").toLocaleLowerCase("en-US");
  }
  return normalized;
}

interface UpsertOptions {
  now?: string;
  idFactory?: () => string;
  platform?: NodeJS.Platform;
}

/**
 * Registers a folder the user opened. Re-opening a folder that is already registered is a
 * no-op on identity: the existing project keeps its id, name and creation time.
 */
export function upsertManualProject(
  registry: ProjectRegistryV1,
  folder: { rootPath: string; displayName?: string | null },
  options: UpsertOptions = {},
): ProjectRegistryV1 {
  const now = options.now ?? new Date().toISOString();
  const normalized = normalizeProjectPath(folder.rootPath, options.platform);
  const existing = Object.values(registry.projects).find(
    (project) => normalizeProjectPath(project.rootPath, options.platform) === normalized,
  );
  const id = existing?.id ?? (options.idFactory ?? randomUUID)();
  const next: SharedProject = {
    id,
    rootPath: existing?.rootPath ?? path.resolve(folder.rootPath),
    displayName: existing?.displayName ?? folder.displayName ?? null,
    sources: SOURCES.filter((source) => [...(existing?.sources ?? []), "manual"].includes(source)),
    providerRefs: {
      claude: [...(existing?.providerRefs.claude ?? [])],
      codex: [...(existing?.providerRefs.codex ?? [])],
    },
    status: existing?.status ?? null,
    memo: existing?.memo ?? "",
    tracks: existing?.tracks ?? [],
    hidden: existing?.hidden ?? false,
    order: existing?.order ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  return { ...registry, updatedAt: now, projects: { ...registry.projects, [id]: next } };
}

export function removeProjectFromRegistry(
  registry: ProjectRegistryV1,
  projectId: string,
  now = new Date().toISOString(),
): ProjectRegistryV1 {
  if (!registry.projects[projectId]) throw new ProjectRegistryError(`Project ${projectId} was not found`);
  const projects = { ...registry.projects };
  delete projects[projectId];
  return { ...registry, updatedAt: now, projects };
}

interface RegistryStorageOptions {
  registryPath?: string;
  lockRetryMs?: number;
}

const STORE: JsonStoreSpec<ProjectRegistryV1> = {
  label: "project registry",
  parse: parseProjectRegistry,
  empty: () => emptyProjectRegistry(),
  error: (message, options) => new ProjectRegistryError(message, options),
  isContentError: (error) => error instanceof ProjectRegistryError,
};

export async function readProjectRegistry(options: RegistryStorageOptions = {}): Promise<ProjectRegistrySnapshot> {
  const snapshot = await readJsonStore(STORE, options.registryPath ?? PROJECT_REGISTRY_PATH);
  const { value, ...rest } = snapshot;
  return { registry: value, ...rest };
}

export async function updateProjectRegistry(
  update: (registry: ProjectRegistryV1) => ProjectRegistryV1 | Promise<ProjectRegistryV1>,
  options: RegistryStorageOptions = {},
): Promise<ProjectRegistryV1> {
  return updateJsonStore(STORE, options.registryPath ?? PROJECT_REGISTRY_PATH, update, {
    ...(options.lockRetryMs !== undefined ? { lockRetryMs: options.lockRetryMs } : {}),
  });
}

export async function restoreProjectRegistryFromBackup(
  options: RegistryStorageOptions = {},
): Promise<ProjectRegistryV1> {
  return restoreJsonStoreBackup(STORE, options.registryPath ?? PROJECT_REGISTRY_PATH, {
    ...(options.lockRetryMs !== undefined ? { lockRetryMs: options.lockRetryMs } : {}),
  });
}
