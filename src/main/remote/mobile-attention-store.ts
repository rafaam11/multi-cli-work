import type { RemoteAttentionState } from "../../shared/remote-types";
import type { TerminalStatus } from "../../shared/terminal-types";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../storage/json-store";

interface Entry extends RemoteAttentionState { status: string }
interface AttentionFile { version: 1; sessions: Record<string, Entry> }
class AttentionStoreError extends Error {}
const empty = (): AttentionFile => ({ version: 1, sessions: {} });
const zero = (): RemoteAttentionState => ({ generation: 0, seenThrough: 0 });
const notifiable = new Set(["awaiting-input", "awaiting-approval", "exited", "error"]);
const spec: JsonStoreSpec<AttentionFile> = {
  label: "mobile attention", displayName: "모바일 확인 상태(mobile-attention.json)", empty,
  error: (message, options) => new AttentionStoreError(message, options),
  isContentError: error => error instanceof AttentionStoreError,
  parse(value) {
    const file = value as AttentionFile | null;
    if (!file || file.version !== 1 || !file.sessions || typeof file.sessions !== "object" || Array.isArray(file.sessions)) throw new AttentionStoreError("Invalid attention file");
    for (const entry of Object.values(file.sessions)) {
      if (!entry || typeof entry.status !== "string" || !Number.isSafeInteger(entry.generation) || entry.generation < 0 ||
        !Number.isSafeInteger(entry.seenThrough) || entry.seenThrough < 0 || entry.seenThrough > entry.generation) throw new AttentionStoreError("Invalid attention entry");
    }
    return file;
  },
};

/** Durable causal clock, separate from desktop badges/notification policy. */
export class MobileAttentionStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly filePath: string) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  current(sessionId: string): Promise<RemoteAttentionState> {
    return this.serial(async () => {
      const entry = (await readJsonStore(spec, this.filePath)).value.sessions[sessionId];
      return entry ? { generation: entry.generation, seenThrough: entry.seenThrough } : zero();
    });
  }
  observe(sessionId: string, status: TerminalStatus, viewed = false): Promise<RemoteAttentionState> {
    return this.serial(async () => {
      const file = await updateJsonStore(spec, this.filePath, current => {
        const previous = current.sessions[sessionId];
        const generation = (previous?.generation ?? 0) + (notifiable.has(status) && previous?.status !== status ? 1 : 0);
        const entry = { status, generation, seenThrough: viewed ? generation : previous?.seenThrough ?? 0 };
        return { ...current, sessions: { ...current.sessions, [sessionId]: entry } };
      });
      const { generation, seenThrough } = file.sessions[sessionId]!;
      return { generation, seenThrough };
    });
  }
  seen(sessionId: string, observed: number): Promise<RemoteAttentionState> {
    return this.serial(async () => {
      const file = await updateJsonStore(spec, this.filePath, current => {
        const entry = current.sessions[sessionId];
        if (!entry || !Number.isSafeInteger(observed) || observed < 0 || observed > entry.generation) return current;
        return { ...current, sessions: { ...current.sessions, [sessionId]: { ...entry, seenThrough: Math.max(entry.seenThrough, observed) } } };
      });
      const entry = file.sessions[sessionId];
      return entry ? { generation: entry.generation, seenThrough: entry.seenThrough } : zero();
    });
  }
  remove(sessionId: string): Promise<void> {
    return this.serial(async () => {
      await updateJsonStore(spec, this.filePath, current => {
        const sessions = { ...current.sessions };
        delete sessions[sessionId];
        return { ...current, sessions };
      });
    });
  }
}
