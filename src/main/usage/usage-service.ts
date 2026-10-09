import type { ProviderUsage, UsageSnapshot, UsageWindow } from "../../shared/usage-types";

const POLL_MS = 5 * 60_000;
const MIN_REFRESH_MS = 60_000;
const FIRST_BACKOFF_MS = 15_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const WARN_AT_PERCENT = 90;

function parseProviderUsage(value: unknown): ProviderUsage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { windows?: unknown; plan?: unknown; updatedAt?: unknown };
  if (!Array.isArray(raw.windows) || typeof raw.updatedAt !== "string") return null;
  const windows = raw.windows.flatMap((window): UsageWindow[] => {
    if (!window || typeof window !== "object") return [];
    const { kind, usedPercent, resetsAt } = window as Record<string, unknown>;
    if ((kind !== "5h" && kind !== "weekly" && kind !== "other") || typeof usedPercent !== "number") return [];
    return [{ kind, usedPercent, resetsAt: typeof resetsAt === "string" ? resetsAt : null }];
  });
  return { windows, plan: typeof raw.plan === "string" ? raw.plan : null, updatedAt: raw.updatedAt };
}

/** The saved snapshot (`usage-snapshot.json`), or null for anything unreadable. */
export function parseUsageSnapshot(text: string): UsageSnapshot | null {
  try {
    const raw = JSON.parse(text) as { claude?: unknown; codex?: unknown };
    if (!raw || typeof raw !== "object") return null;
    return { claude: parseProviderUsage(raw.claude), codex: parseProviderUsage(raw.codex) };
  } catch {
    return null;
  }
}

/** One attempt to read Claude usage: figures, nothing to read (no login, API key), or try later. */
export type ClaudeReading =
  | { kind: "ok"; usage: ProviderUsage }
  | { kind: "unavailable" }
  | { kind: "retry"; afterMs?: number };

export interface UsageServiceOptions {
  claude(): Promise<ClaudeReading>;
  codex(): Promise<ProviderUsage | null>;
  /** Claude is only asked while it is in use — the endpoint is someone else's to be polite to. */
  hasLiveClaudeSession(): boolean;
  enabled(): boolean;
  notifyEnabled(): boolean;
  notify(provider: "claude" | "codex", window: UsageWindow): void;
  /** The last snapshot, so the gauge has something to show right after a start. */
  store: { read(): Promise<UsageSnapshot | null>; write(snapshot: UsageSnapshot): Promise<void> };
}

/**
 * Keeps the subscription usage of Claude and Codex current: a reading on start, then every five
 * minutes, and on demand (the gauge's popover) no more than once a minute. Claude failures back off
 * from 15 seconds to five minutes, or as long as the server's Retry-After asks.
 */
export class UsageService {
  private current: UsageSnapshot = { claude: null, codex: null };
  private readonly listeners = new Set<(snapshot: UsageSnapshot) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRefreshAt = 0;
  private claudeBlockedUntil = 0;
  private claudeBackoffMs = FIRST_BACKOFF_MS;
  private claudeRead = false;
  private readonly warned = new Set<string>();
  private refreshing: Promise<UsageSnapshot> | null = null;

  constructor(private readonly options: UsageServiceOptions) {}

  async start(): Promise<void> {
    const saved = await this.options.store.read().catch(() => null);
    if (saved) this.current = saved;
    // Saved figures already crossed are not news.
    for (const provider of ["claude", "codex"] as const) {
      for (const window of this.current[provider]?.windows ?? []) {
        if (window.usedPercent >= WARN_AT_PERCENT) this.warned.add(this.warnKey(provider, window));
      }
    }
    if (saved) this.publish();
    await this.refresh(true);
    this.timer = setInterval(() => void this.refresh(true), POLL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  snapshot(): UsageSnapshot {
    return this.current;
  }

  onChange(listener: (snapshot: UsageSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** `scheduled` is the timer's own tick; a request from the UI is held to once a minute. */
  refresh(scheduled = false): Promise<UsageSnapshot> {
    if (this.refreshing) return this.refreshing;
    if (!this.options.enabled()) return Promise.resolve(this.current);
    const now = Date.now();
    if (!scheduled && now - this.lastRefreshAt < MIN_REFRESH_MS) return Promise.resolve(this.current);
    this.lastRefreshAt = now;
    this.refreshing = this.read(now).finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async read(now: number): Promise<UsageSnapshot> {
    const next: UsageSnapshot = { ...this.current };
    const askClaude = (!this.claudeRead || this.options.hasLiveClaudeSession()) && now >= this.claudeBlockedUntil;
    if (askClaude) {
      const reading = await this.options.claude().catch((): ClaudeReading => ({ kind: "retry" }));
      if (reading.kind === "ok") {
        this.claudeRead = true;
        this.claudeBackoffMs = FIRST_BACKOFF_MS;
        next.claude = reading.usage;
      } else if (reading.kind === "unavailable") {
        this.claudeRead = true;
      } else {
        const wait = Math.min(MAX_BACKOFF_MS, reading.afterMs ?? this.claudeBackoffMs);
        this.claudeBlockedUntil = now + wait;
        this.claudeBackoffMs = Math.min(MAX_BACKOFF_MS, this.claudeBackoffMs * 2);
      }
    }
    const codex = await this.options.codex().catch(() => null);
    if (codex) next.codex = codex;

    const changed = JSON.stringify(next) !== JSON.stringify(this.current);
    this.current = next;
    this.warnOnCrossing();
    if (changed) {
      this.publish();
      await this.options.store.write(next).catch(() => undefined);
    }
    return next;
  }

  private warnKey(provider: string, window: UsageWindow): string {
    return `${provider}:${window.kind}:${window.resetsAt ?? ""}`;
  }

  private warnOnCrossing(): void {
    for (const provider of ["claude", "codex"] as const) {
      for (const window of this.current[provider]?.windows ?? []) {
        if (window.usedPercent < WARN_AT_PERCENT) continue;
        const key = this.warnKey(provider, window);
        if (this.warned.has(key)) continue;
        this.warned.add(key);
        if (this.options.notifyEnabled()) this.options.notify(provider, window);
      }
    }
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.current);
  }
}
