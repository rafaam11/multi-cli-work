import os from "node:os";
import path from "node:path";
import {
  defaultTranscriptIo,
  readTranscriptTail,
  type TranscriptIo,
  type TranscriptTailState,
} from "./transcript-tail";
import { findClaudeTranscript, type SessionTitleOptions, type SessionTitleSource } from "./session-title";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CLAUDE_EDIT_TOOL_NAMES = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

/**
 * Claude's `tool_use` entries carry the edited file's absolute path in `input.file_path`, but key
 * order inside `input` is not fixed (e.g. `Edit`'s `replace_all` can precede `file_path`), so this
 * has to be a real JSON.parse per line rather than a regex.
 */
export function parseClaudeEditedPaths(chunk: string): string[] {
  const paths: string[] = [];
  for (const line of chunk.split(/\r?\n/)) {
    if (!line.includes('"tool_use"')) continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (!isRecord(entry) || entry.type !== "assistant" || !isRecord(entry.message)) continue;
      const content = entry.message.content;
      if (!Array.isArray(content)) continue;
      for (const item of content) {
        if (!isRecord(item) || item.type !== "tool_use") continue;
        if (typeof item.name !== "string" || !CLAUDE_EDIT_TOOL_NAMES.has(item.name)) continue;
        const input = item.input;
        if (isRecord(input) && typeof input.file_path === "string" && input.file_path.length > 0) {
          paths.push(input.file_path);
        }
      }
    } catch {
      // A half-written trailing line is expected while Claude is still appending — not an error.
    }
  }
  return paths;
}

// Codex embeds the whole edited file's content in `changes[path].content`, so a single line can run
// several MB. Lines past this are skipped rather than JSON.parsed — the paths on them are lost until
// the next poll re-reads the same (by then complete) line as part of a fresh tail.
const MAX_CODEX_LINE_LENGTH = 16 * 1024 * 1024;

/**
 * Codex reports edits as a `FileChange` item whose `changes` map is keyed by absolute path. Only the
 * keys are read — `content` is never touched, so the multi-MB payload is never even allocated as a
 * JS string beyond the JSON.parse call itself.
 */
export function parseCodexEditedPaths(chunk: string): string[] {
  const paths: string[] = [];
  for (const line of chunk.split(/\r?\n/)) {
    if (line.length > MAX_CODEX_LINE_LENGTH) continue;
    if (!line.includes('"FileChange"')) continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (!isRecord(entry) || entry.type !== "event_msg" || !isRecord(entry.payload)) continue;
      if (entry.payload.type !== "item_completed" || !isRecord(entry.payload.item)) continue;
      const item = entry.payload.item;
      if (item.type !== "FileChange" || !isRecord(item.changes)) continue;
      paths.push(...Object.keys(item.changes));
    } catch {
      // Same as Claude: a partial trailing line is normal while Codex is still writing it.
    }
  }
  return paths;
}

export interface AgentEditEntry {
  at: number;
  /** Agent edit tools only ever touch files, never directories — matches FileTreeEntry["kind"]. */
  kind: "file";
}

/**
 * Accumulates every file an agent has edited across all live sessions, purely in memory (the feature
 * is explicitly scoped to reset on app restart — see the plan's "강조 수명" decision). One instance is
 * shared across sessions; transcript tail state and resolved transcript paths are kept per-transcript
 * so re-polling a session only reads what was appended since the last check.
 */
export class AgentEditReader {
  private readonly transcriptPaths = new Map<string, string>();
  private readonly tails = new Map<string, TranscriptTailState>();
  private readonly edits = new Map<string, AgentEditEntry>();

  constructor(private readonly io: TranscriptIo = defaultTranscriptIo) {}

  entries(): ReadonlyMap<string, AgentEditEntry> {
    return this.edits;
  }

  /**
   * "변경 표시 지우기" — with no predicate, clears the whole index. `workspace-files:clear-changes`
   * scopes this to one project/worktree root (via a `withinRoot` predicate) so clearing one open
   * project's highlights never erases another unrelated open project's. Nothing here is persisted
   * to disk either way.
   */
  clear(predicate?: (absolutePath: string) => boolean): void {
    if (!predicate) {
      this.edits.clear();
      return;
    }
    for (const absolutePath of this.edits.keys()) {
      if (predicate(absolutePath)) this.edits.delete(absolutePath);
    }
  }

  /** True when this call found at least one new edit — the coordinator only publishes an event then. */
  async refresh(session: SessionTitleSource, options: SessionTitleOptions = {}): Promise<boolean> {
    if (session.titleSource === "none" || !session.providerConversationId) return false;
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
      // Same rule as SessionTitleReader: Codex ownership comes from the SessionStart hook only, a
      // recursive filename match could otherwise claim an unrelated CLI launched concurrently.
      if (session.titleSource === "codex-transcript") return false;
      transcript = await findClaudeTranscript(this.io, baseDirectory, session.cwd, session.providerConversationId) ?? undefined;
      if (!transcript) return false;
    }
    this.transcriptPaths.set(sourceKey, transcript);

    const tail = await readTranscriptTail(this.io, transcript, this.tails.get(transcript));
    if (!tail || !tail.changed) return false;
    this.tails.set(transcript, tail.state);

    const paths = session.titleSource === "claude-transcript"
      ? parseClaudeEditedPaths(tail.complete)
      : parseCodexEditedPaths(tail.complete);
    if (paths.length === 0) return false;
    const at = Date.now();
    for (const filePath of paths) this.edits.set(path.normalize(filePath), { at, kind: "file" });
    return true;
  }
}
