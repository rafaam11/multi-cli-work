import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TitleSource } from "../../shared/agent-types";

const MAX_TITLE_LENGTH = 60;

export interface SessionTitleSource {
  /** Which transcript format to read, if any. An agent with no parser of its own reports `none`. */
  titleSource: TitleSource;
  cwd: string;
  providerConversationId: string | null;
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

async function readIfPresent(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function findClaudeTranscript(directory: string, cwd: string, conversationId: string): Promise<string | null> {
  const derived = path.join(directory, claudeProjectSlug(cwd), `${conversationId}.jsonl`);
  if (await readIfPresent(derived).then((content) => content !== null)) return derived;
  // The slug rule belongs to Claude, not to us, so a rule change should cost a directory walk
  // rather than the whole feature.
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(directory, entry.name, `${conversationId}.jsonl`);
    if (await readIfPresent(candidate).then((content) => content !== null)) return candidate;
  }
  return null;
}

/** Codex file names end with the conversation id, so no transcript needs opening to find one. */
async function findCodexTranscript(directory: string, conversationId: string): Promise<string | null> {
  const suffix = `-${conversationId}.jsonl`;
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const found = await findCodexTranscript(entryPath, conversationId);
      if (found) return found;
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      return entryPath;
    }
  }
  return null;
}

export async function readSessionTitle(
  session: SessionTitleSource,
  options: SessionTitleOptions = {},
): Promise<string | null> {
  if (session.titleSource === "none" || !session.providerConversationId) return null;

  if (session.titleSource === "claude-transcript") {
    const directory = options.claudeProjectsDirectory ?? path.join(os.homedir(), ".claude", "projects");
    const transcript = await findClaudeTranscript(directory, session.cwd, session.providerConversationId);
    if (!transcript) return null;
    const content = await readIfPresent(transcript);
    return content === null ? null : parseClaudeTitle(content);
  }

  const directory = options.codexSessionsDirectory ?? path.join(os.homedir(), ".codex", "sessions");
  const transcript = await findCodexTranscript(directory, session.providerConversationId);
  if (!transcript) return null;
  const content = await readIfPresent(transcript);
  return content === null ? null : parseCodexTitle(content);
}
