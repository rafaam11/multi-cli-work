import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  MAX_VISIBLE_SESSIONS,
  type AppStateSnapshot,
  type AppStateV1,
  type PersistedTerminalSession,
  type SlotViewState,
} from "../../shared/app-state-types";
import type { ToolCommand } from "../../shared/terminal-types";
import { tailOnUtf8Boundary } from "../utf8";

/**
 * A session's agent is checked for shape, not for membership in the agent registry. The registry is
 * a separate, editable file: if removing an agent from it could invalidate the state file, one edit
 * to `agents.json` would cost the user every session they have.
 */
const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const TOOL_COMMANDS: readonly ToolCommand[] = ["claude-update", "codex-update"];
const SESSION_KEYS = [
  "id",
  "projectId",
  "tool",
  "title",
  "name",
  "kind",
  "cwd",
  "worktreeId",
  "providerConversationId",
  "interruptedByShutdown",
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

/** State files written before maintenance sessions existed have no `tool` key at all. */
function toolCommand(value: unknown, label: string): ToolCommand | null {
  if (value === undefined || value === null) return null;
  if (!TOOL_COMMANDS.includes(value as ToolCommand)) throw new AppStateError(`${label} is invalid`);
  return value as ToolCommand;
}

/** Sessions saved before shutdown marking existed omit the key, which must read as false. */
function optionalBoolean(value: unknown, label: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") throw new AppStateError(`${label} must be a boolean`);
  return value;
}

/** Likewise, sessions saved before titles and names existed simply omit those keys. */
function optionalText(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new AppStateError(`${label} must be a string or null`);
  return value.trim().length === 0 ? null : value;
}

function parseSession(value: unknown, key: string): PersistedTerminalSession {
  if (!isRecord(value)) throw new AppStateError(`Session ${key} must be an object`);
  exactKeys(value, SESSION_KEYS, `Session ${key}`);
  const id = string(value.id, `Session ${key}.id`);
  if (id !== key) throw new AppStateError(`Session key ${key} does not match id ${id}`);
  if (typeof value.kind !== "string" || !AGENT_ID_PATTERN.test(value.kind)) {
    throw new AppStateError(`Session ${key}.kind is invalid`);
  }
  // worktreeId is omitted, not null, when a session runs at the project root: only state files
  // that actually use worktrees carry the key, so everyone else's state still loads in older builds.
  const worktreeId = value.worktreeId === undefined || value.worktreeId === null
    ? undefined
    : string(value.worktreeId, `Session ${key}.worktreeId`);
  return {
    id,
    projectId: nullableString(value.projectId, `Session ${key}.projectId`),
    tool: toolCommand(value.tool, `Session ${key}.tool`),
    title: optionalText(value.title, `Session ${key}.title`),
    name: optionalText(value.name, `Session ${key}.name`),
    kind: value.kind,
    cwd: string(value.cwd, `Session ${key}.cwd`),
    ...(worktreeId !== undefined ? { worktreeId } : {}),
    providerConversationId: nullableString(value.providerConversationId, `Session ${key}.providerConversationId`),
    interruptedByShutdown: optionalBoolean(value.interruptedByShutdown, `Session ${key}.interruptedByShutdown`),
    createdAt: iso(value.createdAt, `Session ${key}.createdAt`),
    updatedAt: iso(value.updatedAt, `Session ${key}.updatedAt`),
  };
}

/**
 * The grid panes, present only while the grid shows something (like a session's worktreeId).
 * Files from before the grid carry the single `splitSessionId` instead; folding it here means the
 * rest of the app only ever sees the array.
 */
function visibleSessionIdsOf(value: Record<string, unknown>): string[] | undefined {
  if (value.visibleSessionIds !== undefined && value.visibleSessionIds !== null) {
    if (!Array.isArray(value.visibleSessionIds)) {
      throw new AppStateError("App state visibleSessionIds must be an array");
    }
    const ids = value.visibleSessionIds.map((entry, index) =>
      string(entry, `App state visibleSessionIds[${index}]`),
    );
    const unique = [...new Set(ids)].slice(0, MAX_VISIBLE_SESSIONS);
    return unique.length > 0 ? unique : undefined;
  }
  const splitSessionId =
    value.splitSessionId === undefined || value.splitSessionId === null
      ? undefined
      : string(value.splitSessionId, "App state splitSessionId");
  if (splitSessionId === undefined) return undefined;
  const selectedSessionId = typeof value.selectedSessionId === "string" ? value.selectedSessionId : null;
  return [...new Set([selectedSessionId, splitSessionId].filter((id): id is string => id !== null && id.length > 0))];
}

/**
 * A saved grid. The layout id is checked for shape only — the catalog that names it lives in the
 * renderer, and an id main has never heard of must not cost the user their arrangement; the
 * renderer falls back on a layout of the right size instead.
 *
 * Two normalisations keep the file from drifting: a session sits in at most one slot per view
 * (later repeats read as empty), and trailing empty slots are dropped because the layout already
 * says how many slots exist. Leading and middle nulls stay — those are positions the user left open.
 */
function parseSlotView(value: unknown, label: string): SlotViewState {
  if (!isRecord(value)) throw new AppStateError(`${label} must be an object`);
  exactKeys(value, ["layoutId", "slots"], label);
  const layoutId = string(value.layoutId, `${label}.layoutId`);
  if (!Array.isArray(value.slots)) throw new AppStateError(`${label}.slots must be an array`);
  const seen = new Set<string>();
  const slots = value.slots.map((entry, index) => {
    if (entry === undefined || entry === null) return null;
    const id = string(entry, `${label}.slots[${index}]`);
    if (seen.has(id)) return null;
    seen.add(id);
    return id;
  });
  while (slots.length > 0 && slots[slots.length - 1] === null) slots.pop();
  return { layoutId, slots };
}

function folderViewsOf(value: Record<string, unknown>): Record<string, SlotViewState> | undefined {
  if (value.folderViews === undefined || value.folderViews === null) return undefined;
  if (!isRecord(value.folderViews)) throw new AppStateError("App state folderViews must be an object");
  const entries = Object.entries(value.folderViews).map(
    ([key, view]) => [key, parseSlotView(view, `App state folderViews.${key}`)] as const,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** How many shelves the sidebar offered up to v1.19, and so how many a legacy file may carry. */
const LEGACY_WORKSPACE_COUNT = 3;

/**
 * The workspace grid. Files up to v1.19 have an array of three curated workspaces here instead;
 * those fold into one grid, panes in sidebar order, so the user finds everything they had rather
 * than only the first shelf. Folding at parse time means the legacy key never reaches the rest of
 * the app, and the first write drops it from the file.
 */
function workspaceOf(value: Record<string, unknown>): SlotViewState | undefined {
  if (value.workspace !== undefined && value.workspace !== null) {
    const view = parseSlotView(value.workspace, "App state workspace");
    return view.slots.length > 0 ? view : undefined;
  }
  if (value.workspaces === undefined || value.workspaces === null) return undefined;
  if (!Array.isArray(value.workspaces)) throw new AppStateError("App state workspaces must be an array");
  const views = value.workspaces
    .slice(0, LEGACY_WORKSPACE_COUNT)
    .map((view, index) => parseSlotView(view, `App state workspaces[${index}]`));
  if (views.length === 0) return undefined;
  // Holes are dropped: three grids' worth of deliberately-empty slots say nothing about where the
  // panes belong in the single grid that replaces them.
  const slots = [...new Set(views.flatMap((view) => view.slots.filter((id): id is string => id !== null)))];
  return slots.length > 0 ? { layoutId: views[0].layoutId, slots } : undefined;
}

function hiddenPanesOf(value: Record<string, unknown>): SlotViewState | undefined {
  if (value.hiddenPanes === undefined || value.hiddenPanes === null) return undefined;
  const view = parseSlotView(value.hiddenPanes, "App state hiddenPanes");
  return view.slots.length > 0 ? view : undefined;
}

export function parseAppState(value: unknown): AppStateV1 {
  if (!isRecord(value)) throw new AppStateError("App state must be an object");
  exactKeys(
    value,
    [
      "schemaVersion",
      "updatedAt",
      "selectedProjectId",
      "selectedSessionId",
      "splitSessionId",
      "visibleSessionIds",
      "folderViews",
      "workspace",
      "hiddenPanes",
      "workspaces",
      "sessions",
    ],
    "App state",
  );
  if (value.schemaVersion !== 1) throw new AppStateError(`Unsupported app state schema: ${String(value.schemaVersion)}`);
  if (!isRecord(value.sessions)) throw new AppStateError("App state sessions must be an object");
  const visibleSessionIds = visibleSessionIdsOf(value);
  const folderViews = folderViewsOf(value);
  const workspace = workspaceOf(value);
  const hiddenPanes = hiddenPanesOf(value);
  return {
    schemaVersion: 1,
    updatedAt: iso(value.updatedAt, "App state updatedAt"),
    selectedProjectId: nullableString(value.selectedProjectId, "App state selectedProjectId"),
    selectedSessionId: nullableString(value.selectedSessionId, "App state selectedSessionId"),
    ...(visibleSessionIds !== undefined ? { visibleSessionIds } : {}),
    ...(folderViews !== undefined ? { folderViews } : {}),
    ...(workspace !== undefined ? { workspace } : {}),
    ...(hiddenPanes !== undefined ? { hiddenPanes } : {}),
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
  const bounded = tailOnUtf8Boundary(current, maxBytes);
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
  return tailOnUtf8Boundary(data, maxBytes).toString("utf8");
}

export async function deleteSessionLog(logDir: string, sessionId: string): Promise<void> {
  await fs.rm(safeSessionLogPath(logDir, sessionId), { force: true });
}
