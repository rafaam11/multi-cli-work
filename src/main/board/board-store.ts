import fs from "node:fs/promises";
import path from "node:path";
import type { BoardMessage, BoardRecipient } from "../../shared/board-types";

/**
 * One append-only JSONL file per folder. A message is a `message` line; a delivery that moves on is
 * a `patch` line naming the message — nothing is rewritten in place, so a crash mid-write loses one
 * line at most, and a torn last line is skipped on read. Only the last `KEEP` messages are kept in
 * memory; the file is compacted down to them once it has grown well past that.
 */

const KEEP = 500;
const COMPACT_LINES = 4 * KEEP;

type BoardLine = { type: "message"; message: BoardMessage } | { type: "patch"; id: string; to: BoardRecipient[] };

export class BoardStore {
  private readonly cache = new Map<string, BoardMessage[]>();
  private readonly loading = new Map<string, Promise<BoardMessage[]>>();
  private readonly writes = new Map<string, Promise<void>>();

  constructor(private readonly directory: string) {}

  async list(projectId: string): Promise<BoardMessage[]> {
    return [...(await this.load(projectId))];
  }

  async append(message: BoardMessage): Promise<void> {
    const messages = await this.load(message.projectId);
    messages.push(message);
    if (messages.length > KEEP) messages.splice(0, messages.length - KEEP);
    await this.write(message.projectId, { type: "message", message });
  }

  /** Replaces the message's recipients; null when the message is no longer kept. */
  async patch(projectId: string, id: string, to: BoardRecipient[]): Promise<BoardMessage | null> {
    const messages = await this.load(projectId);
    const index = messages.findIndex((message) => message.id === id);
    if (index < 0) return null;
    const next = { ...messages[index], to };
    messages[index] = next;
    await this.write(projectId, { type: "patch", id, to });
    return next;
  }

  private fileFor(projectId: string): string {
    // Project ids are UUIDs, but nothing outside this file should be able to name a path with one.
    return path.join(this.directory, `${projectId.replace(/[^A-Za-z0-9_-]/g, "_")}.jsonl`);
  }

  private load(projectId: string): Promise<BoardMessage[]> {
    const cached = this.cache.get(projectId);
    if (cached) return Promise.resolve(cached);
    const pending = this.loading.get(projectId);
    if (pending) return pending;
    const loading = this.read(projectId).then((messages) => {
      this.cache.set(projectId, messages);
      this.loading.delete(projectId);
      return messages;
    });
    this.loading.set(projectId, loading);
    return loading;
  }

  private async read(projectId: string): Promise<BoardMessage[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.fileFor(projectId), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const lines = raw.split("\n").filter((line) => line.trim().length > 0);
    const messages: BoardMessage[] = [];
    const byId = new Map<string, number>();
    for (const line of lines) {
      let parsed: BoardLine;
      try {
        parsed = JSON.parse(line) as BoardLine;
      } catch {
        continue;
      }
      if (parsed.type === "message" && parsed.message?.id) {
        byId.set(parsed.message.id, messages.length);
        messages.push(parsed.message);
      } else if (parsed.type === "patch") {
        const index = byId.get(parsed.id);
        if (index !== undefined) messages[index] = { ...messages[index], to: parsed.to };
      }
    }
    const kept = messages.slice(-KEEP);
    if (lines.length > COMPACT_LINES) await this.compact(projectId, kept);
    return kept;
  }

  private async compact(projectId: string, messages: BoardMessage[]): Promise<void> {
    const file = this.fileFor(projectId);
    const temp = `${file}.${process.pid}.tmp`;
    const body = messages.map((message) => JSON.stringify({ type: "message", message })).join("\n");
    try {
      await fs.writeFile(temp, body ? `${body}\n` : "", "utf8");
      await fs.rename(temp, file);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => undefined);
    }
  }

  /** Appends are chained per file so two lines can never interleave. */
  private write(projectId: string, line: BoardLine): Promise<void> {
    const previous = this.writes.get(projectId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.directory, { recursive: true });
        await fs.appendFile(this.fileFor(projectId), `${JSON.stringify(line)}\n`, "utf8");
      });
    this.writes.set(projectId, next);
    return next;
  }
}
