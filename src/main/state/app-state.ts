import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  AppStateSnapshot,
  AppStateV1,
  PersistedTerminalSession,
} from "../../shared/app-state-types";
import type { TerminalKind } from "../../shared/terminal-types";

const TERMINAL_KINDS: readonly TerminalKind[] = ["powershell", "claude", "codex"];
const SESSION_KEYS = [
  "id",
  "projectId",
  "kind",
  "cwd",
  "providerConversationId",
  "createdAt",
  "updatedAt",
] as const;

export class AppStateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AppStateError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new AppStateError(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new AppStateError(`${label} must be a non-empty string`);
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return string(value, label);
}

function iso(value: unknown, label: string): string {
  const result = string(value, label);
  if (!Number.isFinite(Date.parse(result))) throw new AppStateError(`${label} must be an ISO timestamp`);
  return result;
}

function parseSession(value: unknown, key: string): PersistedTerminalSession {
  if (!isRecord(value)) throw new AppStateError(`Session ${key} must be an object`);
  exactKeys(value, SESSION_KEYS, `Session ${key}`);
  const id = string(value.id, `Session ${key}.id`);
  if (id !== key) throw new AppStateError(`Session key ${key} does not match id ${id}`);
  if (!TERMINAL_KINDS.includes(value.kind as TerminalKind)) throw new AppStateError(`Session ${key}.kind is invalid`);
  return {
    id,
    projectId: string(value.projectId, `Session ${key}.projectId`),
    kind: value.kind as TerminalKind,
    cwd: string(value.cwd, `Session ${key}.cwd`),
    providerConversationId: nullableString(value.providerConversationId, `Session ${key}.providerConversationId`),
    createdAt: iso(value.createdAt, `Session ${key}.createdAt`),
    updatedAt: iso(value.updatedAt, `Session ${key}.updatedAt`),
  };
}

export function parseAppState(value: unknown): AppStateV1 {
  if (!isRecord(value)) throw new AppStateError("App state must be an object");
  exactKeys(value, ["schemaVersion", "updatedAt", "selectedProjectId", "selectedSessionId", "sessions"], "App state");
  if (value.schemaVersion !== 1) throw new AppStateError(`Unsupported app state schema: ${String(value.schemaVersion)}`);
  if (!isRecord(value.sessions)) throw new AppStateError("App state sessions must be an object");
  return {
    schemaVersion: 1,
    updatedAt: iso(value.updatedAt, "App state updatedAt"),
    selectedProjectId: nullableString(value.selectedProjectId, "App state selectedProjectId"),
    selectedSessionId: nullableString(value.selectedSessionId, "App state selectedSessionId"),
    sessions: Object.fromEntries(Object.entries(value.sessions).map(([key, session]) => [key, parseSession(session, key)])),
  };
}

export function emptyAppState(now = new Date().toISOString()): AppStateV1 {
  return { schemaVersion: 1, updatedAt: now, selectedProjectId: null, selectedSessionId: null, sessions: {} };
}

interface StateOptions {
  statePath: string;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function readAppState(options: StateOptions): Promise<AppStateSnapshot> {
  let primaryError: unknown;
  try {
    return { state: parseAppState(await readJson(options.statePath)), source: "primary", writable: true };
  } catch (error) {
    primaryError = error;
  }
  try {
    const missing = (primaryError as NodeJS.ErrnoException).code === "ENOENT";
    return {
      state: parseAppState(await readJson(`${options.statePath}.bak`)),
      source: "backup",
      writable: false,
      warning: missing
        ? "Primary app state is missing; using the backup read-only."
        : `Primary app state is invalid: ${(primaryError as Error).message}`,
    };
  } catch (backupError) {
    if (
      (primaryError as NodeJS.ErrnoException).code === "ENOENT" &&
      (backupError as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { state: emptyAppState(), source: "empty", writable: true };
    }
    throw new AppStateError("App state and backup are unreadable", { cause: backupError });
  }
}

let writeChain: Promise<void> = Promise.resolve();

export async function updateAppState(
  update: (state: AppStateV1) => AppStateV1 | Promise<AppStateV1>,
  options: StateOptions,
): Promise<AppStateV1> {
  let result!: AppStateV1;
  const operation = writeChain.then(async () => {
    const snapshot = await readAppState(options);
    if (!snapshot.writable) throw new AppStateError(snapshot.warning ?? "App state is read-only");
    const candidate = await update(snapshot.state);
    result = parseAppState({ ...candidate, updatedAt: new Date().toISOString() });
    await fs.mkdir(path.dirname(options.statePath), { recursive: true });
    try {
      await fs.copyFile(options.statePath, `${options.statePath}.bak`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const tempPath = `${options.statePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      await fs.rename(tempPath, options.statePath);
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  });
  writeChain = operation.then(
    () => undefined,
    () => undefined,
  );
  await operation;
  return result;
}

function safeSessionLogPath(logDir: string, sessionId: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) throw new AppStateError("Session id is unsafe for a log path");
  return path.join(logDir, `${sessionId}.log`);
}

export async function appendSessionLog(
  logDir: string,
  sessionId: string,
  data: string,
  maxBytes: number,
  trimSlackBytes = 0,
): Promise<void> {
  const logPath = safeSessionLogPath(logDir, sessionId);
  await fs.mkdir(logDir, { recursive: true });
  await fs.appendFile(logPath, data);
  const size = (await fs.stat(logPath)).size;
  if (size <= maxBytes + Math.max(0, trimSlackBytes)) return;
  const current = await fs.readFile(logPath);
  const bounded = current.subarray(current.length - maxBytes);
  const tempPath = `${logPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tempPath, bounded);
    await fs.rename(tempPath, logPath);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

export async function readSessionLog(logDir: string, sessionId: string, maxBytes: number): Promise<string> {
  const data = await fs.readFile(safeSessionLogPath(logDir, sessionId)).catch(() => Buffer.alloc(0));
  return (data.length > maxBytes ? data.subarray(data.length - maxBytes) : data).toString("utf8");
}

export async function deleteSessionLog(logDir: string, sessionId: string): Promise<void> {
  await fs.rm(safeSessionLogPath(logDir, sessionId), { force: true });
}
