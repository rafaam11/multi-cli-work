import fs from "node:fs/promises";
import path from "node:path";
import type { ProviderUsage, UsageWindow } from "../../shared/usage-types";

/**
 * Codex usage, from its own session log: each turn's `token_count` event carries the account's
 * rate limits. So the figures are as fresh as the last Codex turn on this machine — in this app or
 * anywhere else — and nothing has to be asked of a server.
 */

const TAIL_BYTES = 256 * 1_024;

function windowKind(minutes: unknown): UsageWindow["kind"] {
  if (minutes === 300) return "5h";
  if (minutes === 10_080) return "weekly";
  return "other";
}

function parseWindow(raw: unknown, lineTime: number): UsageWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const window = raw as { used_percent?: unknown; window_minutes?: unknown; resets_at?: unknown; resets_in_seconds?: unknown };
  if (typeof window.used_percent !== "number" || !Number.isFinite(window.used_percent)) return null;
  let resetsAt: string | null = null;
  if (typeof window.resets_at === "number") resetsAt = new Date(window.resets_at * 1_000).toISOString();
  else if (typeof window.resets_in_seconds === "number") resetsAt = new Date(lineTime + window.resets_in_seconds * 1_000).toISOString();
  return { kind: windowKind(window.window_minutes), usedPercent: Math.min(100, Math.max(0, window.used_percent)), resetsAt };
}

/** The limits of the last `token_count` event that carried any, newest line first. */
export function parseCodexRateLimits(lines: readonly string[], now: Date): ProviderUsage | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.includes("rate_limits")) continue;
    let entry: { timestamp?: unknown; type?: unknown; payload?: { type?: unknown; rate_limits?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "event_msg" || entry.payload?.type !== "token_count") continue;
    const limits = entry.payload.rate_limits as { primary?: unknown; secondary?: unknown; plan_type?: unknown } | null | undefined;
    if (!limits) continue;
    const stamped = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
    const lineTime = Number.isFinite(stamped) ? stamped : now.getTime();
    const windows = [parseWindow(limits.primary, lineTime), parseWindow(limits.secondary, lineTime)].filter(
      (window): window is UsageWindow => window !== null,
    );
    if (windows.length === 0) continue;
    return {
      windows,
      plan: typeof limits.plan_type === "string" ? limits.plan_type : null,
      updatedAt: new Date(lineTime).toISOString(),
    };
  }
  return null;
}

async function newestEntry(dir: string, filter: (name: string) => boolean): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter(filter).sort().reverse();
  } catch {
    return [];
  }
}

/** The newest `rollout-*.jsonl` under `sessions/<year>/<month>/<day>/`. */
export async function latestRolloutFile(sessionsDir: string): Promise<string | null> {
  const numeric = (name: string) => /^\d+$/.test(name);
  for (const year of await newestEntry(sessionsDir, numeric)) {
    for (const month of await newestEntry(path.join(sessionsDir, year), numeric)) {
      for (const day of await newestEntry(path.join(sessionsDir, year, month), numeric)) {
        const dayDir = path.join(sessionsDir, year, month, day);
        const files = await newestEntry(dayDir, (name) => name.startsWith("rollout-") && name.endsWith(".jsonl"));
        if (files.length === 0) continue;
        const stamped = await Promise.all(
          files.map(async (name) => ({ file: path.join(dayDir, name), mtime: (await fs.stat(path.join(dayDir, name))).mtimeMs })),
        );
        return stamped.reduce((newest, candidate) => (candidate.mtime > newest.mtime ? candidate : newest)).file;
      }
    }
  }
  return null;
}

/** The complete lines in the last `maxBytes` of a file — a rollout can run to tens of megabytes. */
export async function readTailLines(file: string, maxBytes = TAIL_BYTES): Promise<string[]> {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const lines = buffer.toString("utf8").split(/\r?\n/);
    if (start > 0) lines.shift();
    return lines.filter((line) => line.length > 0);
  } finally {
    await handle.close();
  }
}

export async function readCodexUsage(sessionsDir: string, now: Date): Promise<ProviderUsage | null> {
  const file = await latestRolloutFile(sessionsDir);
  if (!file) return null;
  return parseCodexRateLimits(await readTailLines(file), now);
}
