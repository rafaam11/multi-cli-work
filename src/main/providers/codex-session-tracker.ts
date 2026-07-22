import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

interface CodexSessionTrackerOptions {
  sessionsDirectory?: string;
  pollIntervalMs?: number;
  maxAttempts?: number;
  maxFiles?: number;
  platform?: NodeJS.Platform;
}

interface SessionMetadata {
  id: string;
  cwd: string;
  modifiedAt: number;
}

const transcriptClaims = new Map<string, Set<string>>();
const DEFAULT_MAX_ATTEMPTS = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedCwd(cwd: string, platform: NodeJS.Platform): string {
  if (platform === "win32") {
    return path.win32.normalize(path.win32.resolve(cwd)).replaceAll("/", "\\").toLocaleLowerCase("en-US");
  }
  return path.posix.normalize(path.posix.resolve(cwd));
}

function claimsForDirectory(directory: string, platform: NodeJS.Platform): Set<string> {
  const resolved = path.resolve(directory);
  const key = platform === "win32" ? resolved.replaceAll("/", "\\").toLocaleLowerCase("en-US") : resolved;
  const existing = transcriptClaims.get(key);
  if (existing) return existing;
  const claims = new Set<string>();
  transcriptClaims.set(key, claims);
  return claims;
}

async function collectJsonlFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  return (
    await Promise.all(
      entries.map(async (entry): Promise<string[]> => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectJsonlFiles(entryPath);
        return entry.isFile() && path.extname(entry.name).toLowerCase() === ".jsonl" ? [entryPath] : [];
      }),
    )
  ).flat();
}

async function readMetadata(filePath: string, modifiedAt: number): Promise<SessionMetadata | null> {
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  try {
    for await (const line of lines) {
      try {
        const record: unknown = JSON.parse(line);
        if (!isRecord(record) || record.type !== "session_meta" || !isRecord(record.payload)) continue;
        const id = record.payload.id ?? record.payload.session_id;
        if (typeof id !== "string" || id.length === 0 || typeof record.payload.cwd !== "string") return null;
        return { id, cwd: record.payload.cwd, modifiedAt };
      } catch {
        // Keep looking because partial or unrelated records can precede session metadata.
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    lines.close();
    input.destroy();
  }
}

export class CodexSessionTracker {
  private readonly sessionsDirectory: string;
  private readonly pollIntervalMs: number;
  private readonly maxAttempts: number;
  private readonly maxFiles: number;
  private readonly platform: NodeJS.Platform;
  private readonly claimedTranscriptIds: Set<string>;

  constructor(options: CodexSessionTrackerOptions = {}) {
    this.sessionsDirectory = options.sessionsDirectory ?? path.join(os.homedir(), ".codex", "sessions");
    this.pollIntervalMs = options.pollIntervalMs ?? 400;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.maxFiles = options.maxFiles ?? 300;
    this.platform = options.platform ?? process.platform;
    this.claimedTranscriptIds = claimsForDirectory(this.sessionsDirectory, this.platform);
  }

  async snapshot(cwd: string): Promise<ReadonlySet<string>> {
    return new Set((await this.sessionsForCwd(cwd)).map((session) => session.id));
  }

  async waitForNew(cwd: string, knownIds: ReadonlySet<string>, signal?: AbortSignal): Promise<string | null> {
    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      if (signal?.aborted) return null;
      const created = (await this.sessionsForCwd(cwd)).find(
        (session) => !knownIds.has(session.id) && !this.claimedTranscriptIds.has(session.id),
      );
      if (created) {
        this.claimedTranscriptIds.add(created.id);
        return created.id;
      }
      if (attempt + 1 < this.maxAttempts) {
        try {
          await delay(this.pollIntervalMs, undefined, { signal });
        } catch (error) {
          if (signal?.aborted || (error as Error).name === "AbortError") return null;
          throw error;
        }
      }
    }
    return null;
  }

  private async sessionsForCwd(cwd: string): Promise<SessionMetadata[]> {
    const requested = normalizedCwd(cwd, this.platform);
    const files = await collectJsonlFiles(this.sessionsDirectory);
    const recent = (
      await Promise.all(
        files.map(async (filePath) => {
          try {
            return { filePath, modifiedAt: (await fs.stat(filePath)).mtimeMs };
          } catch {
            return null;
          }
        }),
      )
    )
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((left, right) => right.modifiedAt - left.modifiedAt)
      .slice(0, this.maxFiles);
    const metadata = await Promise.all(recent.map(({ filePath, modifiedAt }) => readMetadata(filePath, modifiedAt)));
    return metadata
      .filter((entry): entry is SessionMetadata => entry !== null && normalizedCwd(entry.cwd, this.platform) === requested)
      .sort((left, right) => right.modifiedAt - left.modifiedAt);
  }
}
