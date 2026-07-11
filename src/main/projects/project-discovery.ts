import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import type { ProjectDiscovery } from "../../shared/project-types";

const DEFAULT_MAX_FILES = 200;

interface DiscoveryOptions {
  maxFiles?: number;
}

export interface ClaudeDiscoveryOptions extends DiscoveryOptions {
  projectsDirectory?: string;
}

export interface CodexDiscoveryOptions extends DiscoveryOptions {
  sessionsDirectory?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function absoluteProjectPath(value: unknown): string | undefined {
  const rootPath = nonEmptyString(value);
  return rootPath && (path.win32.isAbsolute(rootPath) || path.posix.isAbsolute(rootPath)) ? rootPath : undefined;
}

function claudeProjectRef(projectsDirectory: string, transcriptPath: string): string | undefined {
  const segments = path.relative(projectsDirectory, transcriptPath).split(path.sep);
  return segments.length > 1 ? nonEmptyString(segments[0]) : undefined;
}

export function codexProjectRefFromCwd(cwd: string): string {
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const parsed = path.win32.parse(cwd);
  let localProjectId: string;
  if (parsed.root && /^[A-Za-z]:[\\/]?$/.test(parsed.root)) {
    const drive = parsed.root[0].toUpperCase();
    const rest = cwd
      .slice(parsed.root.length)
      .replace(/[\\/]+/g, "-")
      .replace(/^-+|-+$/g, "");
    localProjectId = rest ? `${drive}--${rest}` : `${drive}--`;
  } else {
    localProjectId = normalized.replace(/^\//, "-").replace(/\//g, "-") || "unknown";
  }
  return `codex:${localProjectId}`;
}

async function collectJsonlFiles(directory: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const paths = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectJsonlFiles(entryPath);
      return entry.isFile() && path.extname(entry.name).toLowerCase() === ".jsonl" ? [entryPath] : [];
    }),
  );
  return paths.flat();
}

async function recentJsonlFiles(directory: string, maxFiles: number): Promise<string[]> {
  const files = await collectJsonlFiles(directory);
  const timestamped = await Promise.all(
    files.map(async (filePath) => {
      try {
        return { filePath, modifiedAt: (await fs.stat(filePath)).mtimeMs };
      } catch {
        return undefined;
      }
    }),
  );
  return timestamped
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
    .sort((left, right) => right.modifiedAt - left.modifiedAt || left.filePath.localeCompare(right.filePath))
    .slice(0, Math.max(0, Math.trunc(maxFiles)))
    .map(({ filePath }) => filePath);
}

async function findJsonRecord(
  filePath: string,
  match: (value: Record<string, unknown>) => ProjectDiscovery | undefined,
): Promise<ProjectDiscovery | undefined> {
  let input: ReturnType<typeof createReadStream> | undefined;
  let lines: readline.Interface | undefined;
  try {
    input = createReadStream(filePath, { encoding: "utf8" });
    lines = readline.createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of lines) {
      try {
        const value: unknown = JSON.parse(line);
        if (!isRecord(value)) continue;
        const discovery = match(value);
        if (discovery) return discovery;
      } catch {
        // A malformed record does not invalidate the rest of the transcript.
      }
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    lines?.close();
    input?.destroy();
  }
}

export async function discoverClaudeProjects(options: ClaudeDiscoveryOptions = {}): Promise<ProjectDiscovery[]> {
  const projectsDirectory = options.projectsDirectory ?? path.join(os.homedir(), ".claude", "projects");
  const files = await recentJsonlFiles(projectsDirectory, options.maxFiles ?? DEFAULT_MAX_FILES);
  const discoveries = await Promise.all(
    files.map((filePath) =>
      findJsonRecord(filePath, (record) => {
        const rootPath = absoluteProjectPath(record.cwd);
        if (!rootPath) return undefined;
        const providerRef = claudeProjectRef(projectsDirectory, filePath);
        return { rootPath, source: "claude", ...(providerRef ? { providerRef } : {}) };
      }),
    ),
  );
  return discoveries.filter((discovery): discovery is ProjectDiscovery => discovery !== undefined);
}

export async function discoverCodexProjects(options: CodexDiscoveryOptions = {}): Promise<ProjectDiscovery[]> {
  const sessionsDirectory = options.sessionsDirectory ?? path.join(os.homedir(), ".codex", "sessions");
  const files = await recentJsonlFiles(sessionsDirectory, options.maxFiles ?? DEFAULT_MAX_FILES);
  const discoveries = await Promise.all(
    files.map((filePath) =>
      findJsonRecord(filePath, (record) => {
        if (record.type !== "session_meta" || !isRecord(record.payload)) return undefined;
        const rootPath = absoluteProjectPath(record.payload.cwd);
        if (!rootPath) return undefined;
        return { rootPath, source: "codex", providerRef: codexProjectRefFromCwd(rootPath) };
      }),
    ),
  );
  return discoveries.filter((discovery): discovery is ProjectDiscovery => discovery !== undefined);
}
