import os from "node:os";
import path from "node:path";
import type { SharedWorktree, WorktreeRegistryV1 } from "../../shared/worktree-types";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../storage/json-store";
import { normalizeWorkspacePath } from "./git-worktree";

export const WORKTREE_REGISTRY_PATH = path.join(os.homedir(), ".multi-cli-work", "worktrees.json");

const WORKTREE_KEYS = ["id", "projectId", "path", "branch", "createdAt", "updatedAt"] as const;

export class WorktreeRegistryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorktreeRegistryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WorktreeRegistryError(`${label} must be a non-empty string`);
  }
  return value;
}

function iso(value: unknown, label: string): string {
  const result = requiredString(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new WorktreeRegistryError(`${label} must be an ISO timestamp`);
  return result;
}

function parseWorktree(value: unknown, key: string): SharedWorktree {
  if (!isRecord(value)) throw new WorktreeRegistryError(`Worktree ${key} must be an object`);
  const unknown = Object.keys(value).filter((field) => !(WORKTREE_KEYS as readonly string[]).includes(field));
  if (unknown.length > 0) {
    throw new WorktreeRegistryError(`Worktree ${key} contains unknown fields: ${unknown.join(", ")}`);
  }
  const id = requiredString(value.id, `Worktree ${key}.id`);
  if (id !== key) throw new WorktreeRegistryError(`Worktree key ${key} does not match id ${id}`);
  return {
    id,
    projectId: requiredString(value.projectId, `Worktree ${key}.projectId`),
    path: requiredString(value.path, `Worktree ${key}.path`),
    branch: requiredString(value.branch, `Worktree ${key}.branch`),
    createdAt: iso(value.createdAt, `Worktree ${key}.createdAt`),
    updatedAt: iso(value.updatedAt, `Worktree ${key}.updatedAt`),
  };
}

export function parseWorktreeRegistry(value: unknown): WorktreeRegistryV1 {
  if (!isRecord(value)) throw new WorktreeRegistryError("Worktree registry must be an object");
  const unknown = Object.keys(value).filter((key) => !["schemaVersion", "updatedAt", "worktrees"].includes(key));
  if (unknown.length > 0) {
    throw new WorktreeRegistryError(`Worktree registry contains unknown fields: ${unknown.join(", ")}`);
  }
  if (value.schemaVersion !== 1) {
    throw new WorktreeRegistryError(`Unsupported worktree registry schema: ${String(value.schemaVersion)}`);
  }
  if (!isRecord(value.worktrees)) throw new WorktreeRegistryError("Worktree registry worktrees must be an object");
  return {
    schemaVersion: 1,
    updatedAt: iso(value.updatedAt, "Worktree registry updatedAt"),
    worktrees: Object.fromEntries(
      Object.entries(value.worktrees).map(([key, worktree]) => [key, parseWorktree(worktree, key)]),
    ),
  };
}

export function emptyWorktreeRegistry(now = new Date().toISOString()): WorktreeRegistryV1 {
  return { schemaVersion: 1, updatedAt: now, worktrees: {} };
}

const STORE: JsonStoreSpec<WorktreeRegistryV1> = {
  label: "worktree registry",
  parse: parseWorktreeRegistry,
  empty: () => emptyWorktreeRegistry(),
  error: (message, options) => new WorktreeRegistryError(message, options),
  isContentError: (error) => error instanceof WorktreeRegistryError,
};

export interface WorktreeRegistryOptions {
  registryPath?: string;
}

function registryPathOf(options: WorktreeRegistryOptions): string {
  return options.registryPath ?? WORKTREE_REGISTRY_PATH;
}

export async function readWorktreeRegistry(options: WorktreeRegistryOptions = {}): Promise<WorktreeRegistryV1> {
  return (await readJsonStore(STORE, registryPathOf(options))).value;
}

export async function addWorktreeEntry(
  worktree: SharedWorktree,
  options: WorktreeRegistryOptions = {},
): Promise<WorktreeRegistryV1> {
  return updateJsonStore(STORE, registryPathOf(options), (registry) => ({
    ...registry,
    updatedAt: worktree.updatedAt,
    worktrees: { ...registry.worktrees, [worktree.id]: worktree },
  }));
}

export async function removeWorktreeEntry(
  worktreeId: string,
  now: string,
  options: WorktreeRegistryOptions = {},
): Promise<WorktreeRegistryV1> {
  return updateJsonStore(STORE, registryPathOf(options), (registry) => {
    const worktrees = { ...registry.worktrees };
    delete worktrees[worktreeId];
    return { ...registry, updatedAt: now, worktrees };
  });
}

export interface WorktreeEntryChanges {
  added: SharedWorktree[];
  removedIds: string[];
}

/**
 * Applies a sync's discoveries and removals on top of the registry as it is now, not as it was
 * when the sync read it: an entry another writer added in the meantime survives, and an addition
 * whose path another writer registered first is dropped instead of duplicated.
 */
export async function applyWorktreeEntryChanges(
  changes: WorktreeEntryChanges,
  now: string,
  options: WorktreeRegistryOptions = {},
): Promise<WorktreeRegistryV1> {
  return updateJsonStore(STORE, registryPathOf(options), (registry) => {
    const worktrees = { ...registry.worktrees };
    for (const worktreeId of changes.removedIds) delete worktrees[worktreeId];
    for (const entry of changes.added) {
      const taken = Object.values(worktrees).some(
        (existing) =>
          existing.projectId === entry.projectId &&
          normalizeWorkspacePath(existing.path) === normalizeWorkspacePath(entry.path),
      );
      if (!taken) worktrees[entry.id] = entry;
    }
    return { ...registry, updatedAt: now, worktrees };
  });
}
