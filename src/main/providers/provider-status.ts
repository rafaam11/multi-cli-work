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
  return {
    sessionId: record.sessionId,
    status: record.status as TerminalStatus,
    event: record.event,
    at: record.at,
  };
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

  const consume = (filename: string) => {
    if (path.basename(filename) !== filename || !filename.endsWith(".json")) return;
    const existing = pending.get(filename);
    if (existing) clearTimeout(existing);
    pending.set(
      filename,
      setTimeout(() => {
        pending.delete(filename);
        void readStatusFile(path.join(statusDir, filename)).then((event) => {
          if (event) onStatus(event);
        });
      }, 25),
    );
  };

  const initial = await fs.readdir(statusDir).catch(() => [] as string[]);
  initial.forEach(consume);
  const watcher = watch(statusDir, (_eventType, filename) => {
    if (filename) consume(filename.toString());
  });
  watcher.on("close", () => {
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  });
  return watcher;
}

