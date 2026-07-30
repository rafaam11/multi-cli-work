import fs from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TitleSource } from "../../shared/agent-types";

const MAX_TITLE_LENGTH = 60;

export interface SessionTitleSource {
  /** Which transcript format to read, if any. An agent with no parser of its own reports `none`. */
  titleSource: TitleSource;
  cwd: string;
  providerConversationId: string | null;
  /** Exact path supplied by the provider hook. Required for Codex to avoid guessing ownership. */
  transcriptPath?: string;
}

export interface SessionTitleOptions {
  claudeProjectsDirectory?: string;
  codexSessionsDirectory?: string;
}

/** Claude names a transcript directory after the folder, with every other character flattened. */
export function claudeProjectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

export function condenseTitle(value: string): string | null {
  const single = value.replace(/\s+/g, " ").trim();
  if (!single) return null;
  return single.length > MAX_TITLE_LENGTH ? `${single.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : single;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Claude rewrites its `ai-title` as the work moves on, so the last one wins. The transcript is read
 * while the CLI is still appending to it, so a truncated final line is expected, not an error.
 */
export function parseClaudeTitle(transcript: string): string | null {
  let title: string | null = null;
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.includes('"ai-title"')) continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (isRecord(entry) && entry.type === "ai-title" && typeof entry.aiTitle === "string") {
        title = entry.aiTitle;
      }
    } catch {
      // A half-written trailing line must not discard the title we already have.
    }
  }
  return title === null ? null : condenseTitle(title);
}

/** Codex writes no title of its own, so what the user first asked for stands in for one. */
export function parseCodexTitle(transcript: string): string | null {
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.includes('"user_message"')) continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (!isRecord(entry) || entry.type !== "event_msg" || !isRecord(entry.payload)) continue;
      if (entry.payload.type === "user_message" && typeof entry.payload.message === "string") {
        return condenseTitle(entry.payload.message);
      }
    } catch {
      // Same as above: a partial line is normal while Codex is running.
    }
  }
  return null;
}

interface SessionTitleIo {
  stat(filePath: string): Promise<Stats>;
  readdir(directory: string): Promise<Dirent[]>;
  read(filePath: string, start: number, length: number): Promise<Buffer>;
}

const defaultIo: SessionTitleIo = {
  stat: (filePath) => fs.stat(filePath),
  readdir: (directory) => fs.readdir(directory, { withFileTypes: true }),
  async read(filePath, start, length) {
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, start);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
};

async function exists(io: SessionTitleIo, filePath: string): Promise<boolean> {
  return io.stat(filePath).then((value) => value.isFile(), () => false);
}

async function findClaudeTranscript(io: SessionTitleIo, directory: string, cwd: string, conversationId: string): Promise<string | null> {
  const derived = path.join(directory, claudeProjectSlug(cwd), `${conversationId}.jsonl`);
  if (await exists(io, derived)) return derived;
  // The slug rule belongs to Claude, not to us, so a rule change should cost a directory walk
  // rather than the whole feature.
  const entries = await io.readdir(directory).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(directory, entry.name, `${conversationId}.jsonl`);
    if (await exists(io, candidate)) return candidate;
  }
  return null;
}

interface TranscriptReadState {
  offset: number;
  mtimeMs: number;
  tail: string;
  title: string | null;
  resolved: boolean;
}

export class SessionTitleReader {
  private readonly transcriptPaths = new Map<string, string>();
  private readonly reads = new Map<string, TranscriptReadState>();

  constructor(private readonly io: SessionTitleIo = defaultIo) {}

  async read(session: SessionTitleSource, options: SessionTitleOptions = {}): Promise<string | null> {
    if (session.titleSource === "none" || !session.providerConversationId) return null;
    const baseDirectory = session.titleSource === "claude-transcript"
      ? options.claudeProjectsDirectory ?? path.join(os.homedir(), ".claude", "projects")
      : options.codexSessionsDirectory ?? path.join(os.homedir(), ".codex", "sessions");
    const sourceKey = JSON.stringify([
      session.titleSource, baseDirectory, session.cwd, session.providerConversationId,
    ]);
    let transcript = session.transcriptPath && path.isAbsolute(session.transcriptPath)
      ? path.normalize(session.transcriptPath)
      : this.transcriptPaths.get(sourceKey);
    if (!transcript) {
      // Codex ownership is established by SessionStart. A recursive filename match can claim an
      // unrelated CLI launched concurrently, so an absent hook path is deliberately not guessed.
      if (session.titleSource === "codex-transcript") return null;
      transcript = await findClaudeTranscript(this.io, baseDirectory, session.cwd, session.providerConversationId) ?? undefined;
      if (!transcript) return null;
      this.transcriptPaths.set(sourceKey, transcript);
    } else {
      this.transcriptPaths.set(sourceKey, transcript);
    }

    const previous = this.reads.get(transcript);
    if (session.titleSource === "codex-transcript" && previous?.resolved) return previous.title;
    let stat: Stats;
    try {
      stat = await this.io.stat(transcript);
    } catch {
      return previous?.title ?? null;
    }
    const unchanged = previous && previous.offset === stat.size && previous.mtimeMs === stat.mtimeMs;
    if (unchanged) return previous.title;
    const appendOnly = previous && stat.size >= previous.offset && stat.mtimeMs >= previous.mtimeMs;
    const start = appendOnly ? previous.offset : 0;
    const chunk = await this.io.read(transcript, start, Math.max(0, stat.size - start));
    const combined = `${appendOnly ? previous.tail : ""}${chunk.toString("utf8")}`;
    const finalNewline = Math.max(combined.lastIndexOf("\n"), combined.lastIndexOf("\r"));
    const complete = finalNewline >= 0 ? combined.slice(0, finalNewline + 1) : "";
    const tail = finalNewline >= 0 ? combined.slice(finalNewline + 1) : combined;
    const parsed = session.titleSource === "claude-transcript"
      ? parseClaudeTitle(complete)
      : parseCodexTitle(complete);
    const title = parsed ?? (appendOnly ? previous.title : null);
    this.reads.set(transcript, {
      offset: stat.size,
      mtimeMs: stat.mtimeMs,
      tail,
      title,
      resolved: session.titleSource === "codex-transcript" && title !== null,
    });
    return title;
  }
}

const defaultReader = new SessionTitleReader();

export function readSessionTitle(session: SessionTitleSource, options: SessionTitleOptions = {}): Promise<string | null> {
  return defaultReader.read(session, options);
}
