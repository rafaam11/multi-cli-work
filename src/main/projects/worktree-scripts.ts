import os from "node:os";
import path from "node:path";
import type { WorktreeScripts } from "../../shared/worktree-types";
import { type JsonStoreSpec, readJsonStore, updateJsonStore } from "../storage/json-store";

/**
 * Per-folder scripts that run when a worktree is made (setup: `npm ci`, copy `.env`…) and before
 * one is removed (teardown). They live in their own file, not in `projects.json`: that registry
 * parses exact keys and an older build would refuse a field it does not know.
 */
export const WORKTREE_SCRIPTS_PATH = path.join(os.homedir(), ".multi-cli-work", "worktree-scripts.json");
export const MAX_SCRIPT_LENGTH = 16_384;
export const DEFAULT_TEARDOWN_TIMEOUT_SEC = 120;
const MAX_TEARDOWN_TIMEOUT_SEC = 3_600;

interface WorktreeScriptsFileV1 {
  schemaVersion: 1;
  updatedAt: string;
  projects: Record<string, WorktreeScripts>;
}

export class WorktreeScriptsError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorktreeScriptsError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One folder's scripts, from the renderer or from disk. Throws on anything out of bounds. */
export function normalizeWorktreeScripts(value: unknown): WorktreeScripts {
  if (!isRecord(value)) throw new WorktreeScriptsError("Worktree scripts must be an object");
  const unknown = Object.keys(value).filter((key) => !["setup", "teardown", "teardownTimeoutSec"].includes(key));
  if (unknown.length > 0) throw new WorktreeScriptsError(`Worktree scripts contain unknown fields: ${unknown.join(", ")}`);
  const script = (raw: unknown, label: string) => {
    if (typeof raw !== "string") throw new WorktreeScriptsError(`${label} script must be a string`);
    if (raw.length > MAX_SCRIPT_LENGTH) throw new WorktreeScriptsError(`${label} script must be at most ${MAX_SCRIPT_LENGTH} characters`);
    return raw;
  };
  const timeout = value.teardownTimeoutSec ?? DEFAULT_TEARDOWN_TIMEOUT_SEC;
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TEARDOWN_TIMEOUT_SEC) {
    throw new WorktreeScriptsError(`Teardown timeout must be 1 to ${MAX_TEARDOWN_TIMEOUT_SEC} seconds`);
  }
  return { setup: script(value.setup, "Setup"), teardown: script(value.teardown, "Teardown"), teardownTimeoutSec: timeout };
}

export function parseWorktreeScripts(value: unknown): WorktreeScriptsFileV1 {
  if (!isRecord(value)) throw new WorktreeScriptsError("Worktree scripts registry must be an object");
  if (value.schemaVersion !== 1) {
    throw new WorktreeScriptsError(`Unsupported worktree scripts schema: ${String(value.schemaVersion)}`);
  }
  if (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new WorktreeScriptsError("Worktree scripts registry updatedAt must be an ISO timestamp");
  }
  if (!isRecord(value.projects)) throw new WorktreeScriptsError("Worktree scripts projects must be an object");
  const projects: Record<string, WorktreeScripts> = {};
  for (const [id, raw] of Object.entries(value.projects)) projects[id] = normalizeWorktreeScripts(raw);
  return { schemaVersion: 1, updatedAt: new Date(Date.parse(value.updatedAt)).toISOString(), projects };
}

const STORE: JsonStoreSpec<WorktreeScriptsFileV1> = {
  label: "worktree scripts registry",
  displayName: "워크트리 스크립트(worktree-scripts.json)",
  parse: parseWorktreeScripts,
  empty: () => ({ schemaVersion: 1, updatedAt: new Date().toISOString(), projects: {} }),
  error: (message, options) => new WorktreeScriptsError(message, options),
  isContentError: (error) => error instanceof WorktreeScriptsError,
};

export interface WorktreeScriptsOptions {
  registryPath?: string;
}

const pathOf = (options: WorktreeScriptsOptions) => options.registryPath ?? WORKTREE_SCRIPTS_PATH;

export async function readWorktreeScripts(projectId: string, options: WorktreeScriptsOptions = {}): Promise<WorktreeScripts | null> {
  return (await readJsonStore(STORE, pathOf(options))).value.projects[projectId] ?? null;
}

/** Saves a folder's scripts; two blank scripts remove the folder's entry. */
export async function setWorktreeScripts(
  projectId: string,
  scripts: WorktreeScripts,
  options: WorktreeScriptsOptions = {},
): Promise<void> {
  const normalized = normalizeWorktreeScripts(scripts);
  const blank = normalized.setup.trim() === "" && normalized.teardown.trim() === "";
  await updateJsonStore(STORE, pathOf(options), (current) => {
    const projects = { ...current.projects };
    if (blank) delete projects[projectId];
    else projects[projectId] = normalized;
    return { ...current, updatedAt: new Date().toISOString(), projects };
  });
}

export async function removeWorktreeScripts(projectId: string, options: WorktreeScriptsOptions = {}): Promise<void> {
  await updateJsonStore(STORE, pathOf(options), (current) => {
    if (!(projectId in current.projects)) return current;
    const projects = { ...current.projects };
    delete projects[projectId];
    return { ...current, updatedAt: new Date().toISOString(), projects };
  });
}
