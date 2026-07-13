import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";

/**
 * The read–merge–write protocol every file under `~/.multi-cli-work/` follows: a cross-process lock,
 * an atomic rename, and a `.bak` that is only ever refreshed from a file that parsed. See
 * `docs/superpowers/specs/registry-contract.md`.
 *
 * Each store keeps its own error type and its own parser; only the file handling is shared.
 */
export interface JsonStoreSpec<T> {
  /** Lower-case name used in messages, e.g. "project registry" → "Primary project registry is invalid: …". */
  label: string;
  parse(value: unknown): T;
  empty(): T;
  /** Wraps a failure so each store keeps throwing its own error type. */
  error(message: string, options?: ErrorOptions): Error;
  /** True when the error says the file's *content* is bad, as opposed to the I/O having failed. */
  isContentError(error: unknown): boolean;
}

export interface JsonStoreSnapshot<T> {
  value: T;
  source: "primary" | "backup" | "empty";
  writable: boolean;
  warning?: string;
}

export interface JsonStoreOptions {
  lockRetryMs?: number;
}

const DEFAULT_LOCK_RETRY_MS = 5_000;

function capitalize(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

/**
 * A primary that will not parse never fails the read outright: the last known-good `.bak` takes over
 * read-only, so the user sees their data and a restore action rather than an empty list.
 */
export async function readJsonStore<T>(spec: JsonStoreSpec<T>, filePath: string): Promise<JsonStoreSnapshot<T>> {
  let primaryError: unknown;
  try {
    return { value: spec.parse(await readJson(filePath)), source: "primary", writable: true };
  } catch (error) {
    primaryError = error;
  }
  try {
    return {
      value: spec.parse(await readJson(`${filePath}.bak`)),
      source: "backup",
      writable: false,
      warning: isMissing(primaryError)
        ? `Primary ${spec.label} is missing; using the backup read-only.`
        : `Primary ${spec.label} is invalid: ${(primaryError as Error).message}`,
    };
  } catch (backupError) {
    if (isMissing(primaryError) && isMissing(backupError)) {
      return { value: spec.empty(), source: "empty", writable: true };
    }
    throw spec.error(`${capitalize(spec.label)} and backup are unreadable`, { cause: backupError });
  }
}

async function writeJsonStore<T>(spec: JsonStoreSpec<T>, filePath: string, value: T): Promise<void> {
  const parsed = spec.parse(value);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    try {
      spec.parse(await readJson(filePath));
      await fs.copyFile(filePath, `${filePath}.bak`);
    } catch (error) {
      // A corrupt primary must never overwrite the last known-good backup. Anything that is neither
      // "not there" nor "does not parse" is real I/O trouble and has to surface.
      if (!isMissing(error) && !(error instanceof SyntaxError) && !spec.isContentError(error)) throw error;
    }
    await fs.writeFile(tempPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function acquireLock(filePath: string, lockRetryMs: number): Promise<() => Promise<void>> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  return lockfile.lock(filePath, {
    realpath: false,
    lockfilePath: `${filePath}.lock`,
    retries: {
      retries: Math.max(1, Math.ceil(lockRetryMs / 100)),
      factor: 1,
      minTimeout: 100,
      maxTimeout: 100,
    },
  });
}

export async function updateJsonStore<T>(
  spec: JsonStoreSpec<T>,
  filePath: string,
  update: (current: T) => T | Promise<T>,
  options: JsonStoreOptions = {},
): Promise<T> {
  const release = await acquireLock(filePath, options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS);
  try {
    const snapshot = await readJsonStore(spec, filePath);
    if (!snapshot.writable) throw spec.error(snapshot.warning ?? `${capitalize(spec.label)} is read-only`);
    const next = spec.parse(await update(snapshot.value));
    await writeJsonStore(spec, filePath, next);
    return next;
  } finally {
    await release();
  }
}

export async function restoreJsonStoreBackup<T>(
  spec: JsonStoreSpec<T>,
  filePath: string,
  options: JsonStoreOptions = {},
): Promise<T> {
  const release = await acquireLock(filePath, options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS);
  try {
    let backup: T;
    try {
      backup = spec.parse(await readJson(`${filePath}.bak`));
    } catch (error) {
      if (spec.isContentError(error)) throw error;
      throw spec.error(`${capitalize(spec.label)} backup is unreadable`, { cause: error });
    }
    await writeJsonStore(spec, filePath, backup);
    return backup;
  } finally {
    await release();
  }
}
