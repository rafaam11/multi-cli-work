import fs from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";

/**
 * The subset of the fs API the transcript readers need, kept as an interface so tests can supply a
 * fake that counts calls without touching disk. Extracted out of session-title.ts so a second
 * transcript reader (agent-edits.ts) doesn't have to duplicate it.
 */
export interface TranscriptIo {
  stat(filePath: string): Promise<Stats>;
  readdir(directory: string): Promise<Dirent[]>;
  read(filePath: string, start: number, length: number): Promise<Buffer>;
}

export const defaultTranscriptIo: TranscriptIo = {
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

export async function transcriptFileExists(io: TranscriptIo, filePath: string): Promise<boolean> {
  return io.stat(filePath).then((value) => value.isFile(), () => false);
}

export interface TranscriptTailState {
  offset: number;
  mtimeMs: number;
  tail: string;
}

export interface TranscriptTailResult {
  /** Complete (newline-terminated) lines read since `previous` — empty string when nothing new. */
  complete: string;
  /** Carry-over state to pass as `previous` on the next call. */
  state: TranscriptTailState;
  /** False when the file's size and mtime match `previous` exactly — `complete` is then always "". */
  changed: boolean;
  /**
   * True when this read continues on from `previous` (the file only grew). False on the first read
   * for a transcript, or when the file shrank/its mtime moved backward — a rewrite from outside the
   * CLI's own append-only writes — in which case the whole file was re-read from offset 0 and any
   * state derived from the old `previous` (e.g. a cached title) is no longer trustworthy on its own.
   */
  appendOnly: boolean;
}

/**
 * Reads only the bytes appended to `filePath` since `previous`, splitting complete lines from a
 * possibly-partial trailing one (the CLI may still be mid-write on the last line — that's expected,
 * not an error). Returns null when the file can't be stat'd (deleted, permissions, etc).
 */
export async function readTranscriptTail(
  io: TranscriptIo,
  filePath: string,
  previous: TranscriptTailState | undefined,
): Promise<TranscriptTailResult | null> {
  let stat: Stats;
  try {
    stat = await io.stat(filePath);
  } catch {
    return null;
  }
  const unchanged = previous !== undefined && previous.offset === stat.size && previous.mtimeMs === stat.mtimeMs;
  if (unchanged) return { complete: "", state: previous, changed: false, appendOnly: true };
  const appendOnly = previous !== undefined && stat.size >= previous.offset && stat.mtimeMs >= previous.mtimeMs;
  const start = appendOnly ? previous!.offset : 0;
  const chunk = await io.read(filePath, start, Math.max(0, stat.size - start));
  const combined = `${appendOnly ? previous!.tail : ""}${chunk.toString("utf8")}`;
  const finalNewline = Math.max(combined.lastIndexOf("\n"), combined.lastIndexOf("\r"));
  const complete = finalNewline >= 0 ? combined.slice(0, finalNewline + 1) : "";
  const tail = finalNewline >= 0 ? combined.slice(finalNewline + 1) : combined;
  return {
    complete,
    state: { offset: stat.size, mtimeMs: stat.mtimeMs, tail },
    changed: true,
    appendOnly,
  };
}
