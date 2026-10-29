import fs from "node:fs/promises";
import path from "node:path";
import type { ProviderActivity } from "../../shared/activity-types";
import { readTailLines } from "../usage/codex-usage";

const EVENTS = new Set(["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "Notification", "Stop", "StopFailure", "Interrupt", "SubagentStart", "SubagentStop", "PreCompact", "PostCompact", "PostModelSwitch", "TaskCreated", "TaskCompleted"]);
export function parseActivity(value: unknown): ProviderActivity {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid activity");
  const raw = value as Record<string, unknown>;
  const string = (key: string, max = 200) => {
    const text = raw[key];
    if (typeof text !== "string" || !text || text.length > max || /[\x00-\x1f\x7f]/.test(text)) throw new Error(`Invalid activity ${key}`);
    return text;
  };
  const provider = string("provider");
  if (provider !== "claude" && provider !== "codex") throw new Error("Unknown provider");
  const event = string("event"); if (!EVENTS.has(event)) throw new Error("Unknown activity event");
  const at = string("at"); if (!Number.isFinite(Date.parse(at))) throw new Error("Invalid activity timestamp");
  const result: ProviderActivity = { id: string("id", 120), sessionId: string("sessionId", 120), generation: string("generation", 120), provider, event, at };
  for (const key of ["toolName", "toolCallId", "agentId", "agentType", "model", "taskId", "taskSubject"] as const) {
    if (raw[key] !== undefined && raw[key] !== null && raw[key] !== "") result[key] = string(key);
  }
  return result;
}

/** Atomic hook event files preserve parallel events independently of the latest status snapshot. */
export class ActivityJournal {
  private events: ProviderActivity[] = [];
  private seen = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private stopped = false;
  private lastPrune = 0;
  constructor(private readonly spool: string, private readonly directory: string,
    private readonly accepts: (event: ProviderActivity) => boolean) {}
  async start() {
    await fs.mkdir(this.spool, { recursive: true }); await fs.mkdir(this.directory, { recursive: true });
    await this.prune();
    const files = (await fs.readdir(this.directory)).filter(file => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)).sort();
    for (const file of files) {
      for (const line of await readTailLines(path.join(this.directory, file), 1024 * 1024)) {
        try { this.remember(parseActivity(JSON.parse(line))); } catch { /* A truncated line is not an event. */ }
      }
    }
    this.schedule();
  }
  list(sessionId?: string) { return this.events.filter(event => !sessionId || event.sessionId === sessionId).map(event => ({ ...event })); }
  async drain() {
    if (this.running) return this.running;
    this.running = this.consume().finally(() => { this.running = null; });
    return this.running;
  }
  async stop() { this.stopped = true; clearTimeout(this.timer); await this.running; }
  private schedule() {
    if (this.stopped) return;
    this.timer = setTimeout(() => { void this.drain().catch(error => console.error("Activity journal", error)).finally(() => this.schedule()); }, 500);
    this.timer.unref();
  }
  private remember(event: ProviderActivity) {
    if (this.seen.has(event.id)) return;
    this.events.push(event); this.seen.add(event.id);
    const order = (name: string) => name === "SessionStart" ? 0 : name === "UserPromptSubmit" ? 1 : ["PreToolUse", "SubagentStart", "TaskCreated", "PreCompact"].includes(name) ? 2 : ["Stop", "StopFailure", "Interrupt", "SessionEnd"].includes(name) ? 4 : 3;
    this.events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || order(a.event) - order(b.event) || a.id.localeCompare(b.id));
    if (this.events.length > 500) { const removed = this.events.shift()!; this.seen.delete(removed.id); }
  }
  private async consume() {
    const files = (await fs.readdir(this.spool)).filter(file => /^[a-zA-Z0-9-]+\.json$/.test(file)).sort().slice(0, 256);
    for (const file of files) {
      const location = path.join(this.spool, file);
      let event: ProviderActivity;
      try {
        if ((await fs.stat(location)).size > 16_384) throw new Error("Oversized activity");
        event = parseActivity(JSON.parse(await fs.readFile(location, "utf8")));
      } catch { await fs.rm(location, { force: true }); continue; }
      if (!this.seen.has(event.id) && this.accepts(event)) {
        // Use receipt time for retention, rather than trusting the hook's clock.
        await fs.appendFile(path.join(this.directory, `${new Date().toISOString().slice(0, 10)}.jsonl`), `${JSON.stringify(event)}\n`, "utf8");
        this.remember(event);
      }
      await fs.rm(location, { force: true });
    }
    if (Date.now() - this.lastPrune > 60_000) await this.prune();
  }
  private async prune() {
    this.lastPrune = Date.now();
    const files = (await fs.readdir(this.directory)).filter(file => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file)).sort().reverse();
    let total = 0;
    for (const file of files) {
      const location = path.join(this.directory, file);
      const size = (await fs.stat(location)).size;
      if (Date.parse(file.slice(0, 10)) < Date.now() - 7 * 86400_000 || total + size > 50 * 1024 * 1024) await fs.rm(location, { force: true });
      else total += size;
    }
  }
}
