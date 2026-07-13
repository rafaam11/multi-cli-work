import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SharedWorktree, WorktreeRegistryV1 } from "../../shared/worktree-types";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../storage/json-store";

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

/**
 * A worktree whose directory is gone (deleted by hand, or removed via git on the command line) has
 * nothing left for the app to offer, so its entry is dropped at startup rather than shown as a node
 * every action on which would fail.
 */
export async function pruneMissingWorktrees(
  now: string,
  options: WorktreeRegistryOptions = {},
): Promise<WorktreeRegistryV1> {
  const registry = await readWorktreeRegistry(options);
  const missing: string[] = [];
  for (const worktree of Object.values(registry.worktrees)) {
    const exists = await fs.stat(worktree.path).then(
      (stats) => stats.isDirectory(),
      () => false,
    );
    if (!exists) missing.push(worktree.id);
  }
  if (missing.length === 0) return registry;
  return updateJsonStore(STORE, registryPathOf(options), (current) => {
    const worktrees = { ...current.worktrees };
    for (const id of missing) delete worktrees[id];
    return { ...current, updatedAt: now, worktrees };
  });
}
