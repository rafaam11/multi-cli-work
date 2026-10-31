import { watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { TerminalStatus } from "../../shared/terminal-types";

const STATUSES: readonly TerminalStatus[] = [
  "starting",
  "working",
  "awaiting-input",
  "awaiting-approval",
  "idle",
  "exited",
  "error",
];

export interface ProviderStatusEvent {
  sessionId: string;
  status: TerminalStatus;
  event: string;
  at: string;
  providerConversationId?: string;
  transcriptPath?: string;
  provider?: "codex" | "claude" | "shell";
  generation?: string;
  cwd?: string;
  model?: string;
  permissionMode?: string;
  toolName?: string;
}

export function parseProviderStatusEvent(value: unknown): ProviderStatusEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Provider status event must be an object");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.sessionId !== "string" || !/^[a-zA-Z0-9-]+$/.test(record.sessionId)) {
    throw new Error("Provider status session id is invalid");
  }
  if (!STATUSES.includes(record.status as TerminalStatus)) throw new Error("Provider status is invalid");
  if (typeof record.event !== "string" || record.event.length === 0) throw new Error("Provider status event name is invalid");
  if (typeof record.at !== "string" || !Number.isFinite(Date.parse(record.at))) {
    throw new Error("Provider status timestamp is invalid");
  }
  if (record.providerConversationId !== undefined && (typeof record.providerConversationId !== "string" || record.providerConversationId.length === 0)) {
    throw new Error("Provider status conversation id is invalid");
  }
  if (record.transcriptPath !== undefined && (typeof record.transcriptPath !== "string" || record.transcriptPath.length === 0)) {
    throw new Error("Provider status transcript path is invalid");
  }
  if (record.provider !== undefined && !["codex", "claude", "shell"].includes(record.provider as string)) throw new Error("Provider is invalid");
  for (const key of ["generation", "cwd"] as const) {
    if (record[key] !== undefined && (typeof record[key] !== "string" || !record[key] || (record[key] as string).includes("\0"))) {
      throw new Error(`Provider ${key} is invalid`);
    }
  }
  for (const key of ["model", "permissionMode", "toolName"] as const) {
    if (record[key] !== undefined && (typeof record[key] !== "string" || !(record[key] as string).length || (record[key] as string).length > 200 || /[\x00-\x1f\x7f]/.test(record[key] as string))) {
      throw new Error(`Provider ${key} is invalid`);
    }
  }
  return {
    sessionId: record.sessionId,
    status: record.status as TerminalStatus,
    event: record.event,
    at: record.at,
    ...(typeof record.providerConversationId === "string" ? { providerConversationId: record.providerConversationId } : {}),
    ...(typeof record.transcriptPath === "string" ? { transcriptPath: record.transcriptPath } : {}),
    ...(record.provider ? { provider: record.provider as ProviderStatusEvent["provider"] } : {}),
    ...(typeof record.generation === "string" ? { generation: record.generation } : {}),
    ...(typeof record.cwd === "string" ? { cwd: record.cwd } : {}),
    ...(typeof record.model === "string" ? { model: record.model } : {}),
    ...(typeof record.permissionMode === "string" ? { permissionMode: record.permissionMode } : {}),
    ...(typeof record.toolName === "string" ? { toolName: record.toolName } : {}),
  };
}

function safeStatusFilePath(statusDir: string, sessionId: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) throw new Error("Provider status session id is unsafe for a file path");
  return path.join(statusDir, `${sessionId}.json`);
}

export async function deleteProviderStatusFile(statusDir: string, sessionId: string): Promise<void> {
  const statusPath = safeStatusFilePath(statusDir, sessionId);
  await Promise.all([
    fs.rm(statusPath, { force: true }),
    fs.rm(statusPath.replace(/\.json$/, ".start.json"), { force: true }),
  ]);
}

/** A hook finishes its write in milliseconds; a temp file older than this was abandoned. */
const STALE_TEMP_MS = 60_000;

export async function cleanupProviderStatusFiles(
  statusDir: string,
  keepSessionIds: ReadonlySet<string>,
  now = Date.now(),
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(statusDir);
  } catch {
    return;
  }
  const orphanStatus = entries.filter(
    (name) => name.endsWith(".json") && !keepSessionIds.has(name.replace(/(?:\.start)?\.json$/, "")),
  );
  // Hooks write `<id>.json.<pid>.tmp` and rename it over the target. Two hooks racing for the same
  // target, or a hook killed mid-write, leave the temp behind — nothing else would ever remove it.
  const staleTemps: string[] = [];
  await Promise.all(
    entries
      .filter((name) => name.endsWith(".tmp"))
      .map(async (name) => {
        const stat = await fs.stat(path.join(statusDir, name)).catch(() => null);
        if (stat && now - stat.mtimeMs > STALE_TEMP_MS) staleTemps.push(name);
      }),
  );
  await Promise.all(
    [...orphanStatus, ...staleTemps].map((name) =>
      fs.rm(path.join(statusDir, name), { force: true }).catch(() => undefined),
    ),
  );
}

async function readStatusFile(filePath: string): Promise<ProviderStatusEvent | null> {
  try {
    return parseProviderStatusEvent(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch {
    return null;
  }
}

export async function startProviderStatusWatcher(
  statusDir: string,
  onStatus: (event: ProviderStatusEvent) => void,
): Promise<FSWatcher> {
  await fs.mkdir(statusDir, { recursive: true });
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const deliveredStarts = new Map<string, string>();
  let closed = false;
  let consumption = Promise.resolve();

  const deliver = (event: ProviderStatusEvent) => {
    if (closed) return;
    if (event.provider === "codex" && event.event === "SessionStart") {
      const key = JSON.stringify([event.generation, event.providerConversationId, event.at]);
      if (deliveredStarts.get(event.sessionId) === key) return;
      deliveredStarts.set(event.sessionId, key);
    }
    onStatus(event);
  };

  const readLatest = async (filename: string) => {
    const event = await readStatusFile(path.join(statusDir, filename));
    if (!event) return;
    if (event.provider === "codex" && event.event !== "SessionStart") {
      const start = await readStatusFile(path.join(statusDir, filename.replace(/\.json$/, ".start.json")));
      if (start?.event === "SessionStart" && start.provider === "codex" &&
          start.sessionId === event.sessionId && start.generation === event.generation &&
          start.providerConversationId === event.providerConversationId) deliver(start);
    }
    deliver(event);
  };

  const consume = (filename: string) => {
    if (!/^[a-zA-Z0-9-]+\.json$/.test(filename)) return;
    const existing = pending.get(filename);
    if (existing) clearTimeout(existing);
    pending.set(
      filename,
      setTimeout(() => {
        pending.delete(filename);
        // Serialize reads so a slower ownership read cannot arrive after the next tool event.
        consumption = consumption.then(() => readLatest(filename)).catch(() => undefined);
      }, 25),
    );
  };

  const watcher = watch(statusDir, (_eventType, filename) => {
    if (filename) consume(filename.toString());
  });
  watcher.on("close", () => {
    closed = true;
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  });
  const initial = await fs.readdir(statusDir).catch(() => [] as string[]);
  initial.forEach(consume);
  return watcher;
}

