import type { TerminalSessionView } from "../../shared/api-types";
import { promptAsTerminalInput, submitTerminalInput } from "../../shared/fan-out";
import type { StatusChip, TerminalEvent } from "../../shared/terminal-types";
import type { HumanDraft } from "../terminal/human-input-tracker";

/**
 * Text one session (or the board, or a preset) wants typed into another. It is never typed straight
 * away: a prompt pasted into a CLI that is mid-turn, parked on an approval, or under a person's
 * fingers lands in the wrong place. Each message waits here until its target is idle, nobody is
 * typing there, and the screen has settled — then it goes in, one per target at a time.
 *
 * Held messages live in memory only. An app restart drops them, and their senders see them fail.
 */

export type DeliveryState = "held" | "delivered" | "failed" | "dropped";
export type HoldReason = "working" | "awaiting-approval" | "typing" | "starting" | "settling" | "dialog";

/**
 * Screens a CLI puts up before it reads prompts, which no status hook reports: Claude's folder trust
 * and bypass-permissions warnings, Codex's hook trust and folder approval. Typed text lands on their
 * options — a "2" in a message picks "No, exit" on Claude's — so nothing goes in until a person has
 * answered. Matched against the screen with spacing and case dropped, since TUIs draw with cursor
 * moves rather than spaces.
 */
const BLOCKING_DIALOGS = [/yes,?itrustthisfolder/g, /doyoutrustthe(files|contents)/g, /trustallandcontinue/g, /yes,?iaccept/g, /allowcodextowork/g];
/**
 * What the CLIs draw around their prompt box. Seen after a dialog's text, it means the dialog has
 * closed — Codex repaints its hook dialog once more on the way out, after the answering keystroke.
 */
const PROMPT_READY = [/askcodextodoanything/g, /\?forshortcuts/g, /shift\+tabtocycle/g];
const DIALOG_WINDOW = 600;
/** Where the last match of any pattern ends, or -1. */
function lastMatchEnd(text: string, patterns: readonly RegExp[]): number {
  let end = -1;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) end = Math.max(end, match.index + match[0].length);
  }
  return end;
}
const ANSI = new RegExp(`${String.fromCharCode(27)}(?:\\[[0-9;?]*[ -/]*[@-~]|\\][^\\u0007]*(?:\\u0007|${String.fromCharCode(27)}\\\\)|.)`, "g");

export interface DeliveryRecord {
  id: string;
  /** The sending session, when a session sent it. */
  from: string | null;
  to: string;
  /** The text as asked for — without the sender prefix. */
  text: string;
  state: DeliveryState;
  /** Why it is still held, or why it failed. */
  reason: HoldReason | string | null;
  createdAt: number;
  settledAt: number | null;
}

export interface DeliveryRequest {
  to: string;
  text: string;
  from?: string | null;
  /** A prefix to use instead of the sending session's name, e.g. "board: 빌더". */
  label?: string;
  /** No prefix at all. */
  raw?: boolean;
  /** Do not wait for the target's turn to end. A person typing and an approval prompt still hold it. */
  urgent?: boolean;
}

export interface DeliveryQueueOptions {
  sessions(): TerminalSessionView[];
  write(sessionId: string, data: string): Promise<void>;
  onEvent(listener: (event: TerminalEvent) => void): () => void;
  draft(sessionId: string): HumanDraft;
  onDraftChange(listener: (sessionId: string) => void): () => void;
  setChip(sessionId: string, chip: StatusChip): void;
  clearChips(sessionId: string, key: string): void;
  idFactory(): string;
  now?: () => number;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  /** How long after a person's last keystroke the session counts as theirs. */
  typingQuietMs?: number;
  /** How long the screen must stay still — Codex reports idle on its first byte, before its TUI is up. */
  outputQuietMs?: number;
  /** Gap kept after a delivery before the next one to the same target. */
  cooldownMs?: number;
  expireMs?: number;
  /** Waits out the pause between a prompt's text and its Enter (`submitTerminalInput`). */
  sleep?: (ms: number) => Promise<void>;
}

export const HELD_CHIP_KEY = "jk-held";
const TICK_MS = 500;
const KEEP_SETTLED_MS = 10 * 60_000;
const MAX_SETTLED = 500;

const ESC = String.fromCharCode(27);

/**
 * Control characters would let a message steer the target's terminal — an `ESC[201~` ends the
 * bracketed paste early and turns the rest of the text into keystrokes. Newlines and tabs survive.
 */
export function sanitizeDeliveryText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

export function sessionLabel(session: Pick<TerminalSessionView, "id" | "name" | "title" | "kind">): string {
  return session.name?.trim() || session.title?.trim() || `${session.kind}-${session.id.slice(0, 4)}`;
}

export class DeliveryQueue {
  private readonly records = new Map<string, DeliveryRecord>();
  private readonly lastOutputAt = new Map<string, number>();
  /** The tail of each session's screen text, compacted, for spotting a blocking dialog. */
  private readonly screenTails = new Map<string, string>();
  private readonly inDialog = new Set<string>();
  /**
   * Sessions whose last keystroke answered a dialog. The Enter that did it reads as a submitted
   * prompt and marks the session working, but no turn starts — Codex never reports one ending — so
   * that working is not held for, until the provider's next status or the person's next keystroke.
   */
  private readonly answeredDialog = new Set<string>();
  private readonly lastDeliveredAt = new Map<string, number>();
  private readonly urgent = new Set<string>();
  private readonly prefixes = new Map<string, string>();
  private readonly listeners = new Set<(record: DeliveryRecord) => void>();
  private readonly waiters = new Map<string, Set<(record: DeliveryRecord) => void>>();
  private readonly unsubscribers: Array<() => void>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private ticker: unknown = null;
  private pumping: Promise<void> | null = null;
  private pumpAgain = false;

  constructor(private readonly options: DeliveryQueueOptions) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.unsubscribers = [
      options.onEvent((event) => {
        if (event.type === "data") {
          this.lastOutputAt.set(event.sessionId, this.now());
          this.watchScreen(event.sessionId, event.data);
        }
        if (event.type === "removed" || event.type === "exit") {
          this.lastOutputAt.delete(event.sessionId);
          this.screenTails.delete(event.sessionId);
          this.inDialog.delete(event.sessionId);
          this.answeredDialog.delete(event.sessionId);
        }
        if (event.type === "status" && event.status !== "working") this.answeredDialog.delete(event.sessionId);
        if (event.type === "status" || event.type === "exit" || event.type === "removed") void this.pump();
      }),
      // A person's keystroke is the answer to whatever dialog was up.
      options.onDraftChange((sessionId) => {
        if (this.inDialog.has(sessionId)) this.answeredDialog.add(sessionId);
        else this.answeredDialog.delete(sessionId);
        this.inDialog.delete(sessionId);
        this.screenTails.delete(sessionId);
        void this.pump();
      }),
    ];
  }

  async enqueue(request: DeliveryRequest): Promise<DeliveryRecord> {
    const record: DeliveryRecord = {
      id: this.options.idFactory(),
      from: request.from ?? null,
      to: request.to,
      text: request.text,
      state: "held",
      reason: null,
      createdAt: this.now(),
      settledAt: null,
    };
    this.records.set(record.id, record);
    this.prefixes.set(record.id, this.prefixFor(request));
    if (request.urgent) this.urgent.add(record.id);
    await this.pump();
    return { ...(this.records.get(record.id) ?? record) };
  }

  held(sessionId?: string): DeliveryRecord[] {
    return [...this.records.values()]
      .filter((record) => record.state === "held" && (sessionId === undefined || record.to === sessionId))
      .map((record) => ({ ...record }));
  }

  get(id: string): DeliveryRecord | null {
    const record = this.records.get(id);
    return record ? { ...record } : null;
  }

  drop(id: string): DeliveryRecord | null {
    const record = this.records.get(id);
    if (!record || record.state !== "held") return null;
    this.settle(record, "dropped", "취소됨");
    return { ...record };
  }

  /** Resolves once the message leaves the held state, or with it still held when time runs out. */
  waitFor(id: string, timeoutMs: number): Promise<DeliveryRecord> {
    const record = this.records.get(id);
    if (!record) return Promise.reject(new Error(`알 수 없는 메시지: ${id}`));
    if (record.state !== "held") return Promise.resolve({ ...record });
    return new Promise((resolve) => {
      const waiters = this.waiters.get(id) ?? new Set();
      this.waiters.set(id, waiters);
      const done = (settled: DeliveryRecord) => {
        clearTimeout(timer);
        waiters.delete(done);
        resolve(settled);
      };
      const timer = setTimeout(() => {
        waiters.delete(done);
        resolve(this.get(id) ?? { ...record });
      }, timeoutMs);
      (timer as { unref?: () => void }).unref?.();
      waiters.add(done);
    });
  }

  onChange(listener: (record: DeliveryRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.stopTicker();
  }

  /** Delivers whatever is ready, oldest first, one message per target per pass. */
  /** Runs a pass; while one is under way, asks it for another and resolves when it ends. */
  pump(): Promise<void> {
    if (this.pumping) {
      this.pumpAgain = true;
      return this.pumping;
    }
    this.pumping = (async () => {
      try {
        do {
          this.pumpAgain = false;
          await this.pumpOnce();
        } while (this.pumpAgain);
      } finally {
        this.pumping = null;
        this.syncTicker();
      }
    })();
    return this.pumping;
  }

  private async pumpOnce(): Promise<void> {
    const sessions = new Map(this.options.sessions().map((session) => [session.id, session]));
    const visited = new Set<string>();
    const touched = new Set<string>();
    for (const record of [...this.records.values()]) {
      if (record.state !== "held" || visited.has(record.to)) continue;
      visited.add(record.to);
      touched.add(record.to);
      const verdict = this.readiness(record, sessions.get(record.to));
      if (verdict.kind === "fail") {
        // Everything else queued for a target that is gone fails with it.
        for (const other of this.records.values()) {
          if (other.state === "held" && other.to === record.to) this.settle(other, "failed", verdict.reason);
        }
        continue;
      }
      if (verdict.kind === "hold") {
        if (record.reason !== verdict.reason) {
          record.reason = verdict.reason;
          this.emit(record);
        }
        continue;
      }
      const prefix = this.prefixes.get(record.id) ?? "";
      try {
        const input = promptAsTerminalInput(`${prefix}${sanitizeDeliveryText(record.text)}`);
        await submitTerminalInput((data) => this.options.write(record.to, data), input, this.sleep);
        // This Enter does start a turn.
        this.answeredDialog.delete(record.to);
        this.lastDeliveredAt.set(record.to, this.now());
        this.settle(record, "delivered", null);
      } catch (error) {
        this.settle(record, "failed", error instanceof Error ? error.message : String(error));
      }
    }
    for (const sessionId of touched) this.syncChip(sessionId);
    this.prune();
  }

  private readiness(
    record: DeliveryRecord,
    session: TerminalSessionView | undefined,
  ): { kind: "ready" } | { kind: "hold"; reason: HoldReason } | { kind: "fail"; reason: string } {
    const now = this.now();
    if (!session) return { kind: "fail", reason: "대상 세션이 없습니다" };
    if (session.pid === null || session.status === "exited" || session.status === "error") {
      return { kind: "fail", reason: `대상 세션이 종료됐습니다 (${session.status})` };
    }
    if (now - record.createdAt > (this.options.expireMs ?? 30 * 60_000)) {
      return { kind: "fail", reason: "보류 시간 초과" };
    }
    const draft = this.options.draft(record.to);
    if (draft.length > 0) return { kind: "hold", reason: "typing" };
    if (draft.lastInputAt !== null && now - draft.lastInputAt < (this.options.typingQuietMs ?? 3000)) {
      return { kind: "hold", reason: "typing" };
    }
    if (this.inDialog.has(record.to)) return { kind: "hold", reason: "dialog" };
    if (session.status === "awaiting-approval") return { kind: "hold", reason: "awaiting-approval" };
    if (session.status === "starting") return { kind: "hold", reason: "starting" };
    if (session.status === "working" && !this.urgent.has(record.id) && !this.answeredDialog.has(record.to)) {
      return { kind: "hold", reason: "working" };
    }
    const output = this.lastOutputAt.get(record.to);
    if (output !== undefined && now - output < (this.options.outputQuietMs ?? 1200)) {
      return { kind: "hold", reason: "settling" };
    }
    const delivered = this.lastDeliveredAt.get(record.to);
    if (delivered !== undefined && now - delivered < (this.options.cooldownMs ?? 2500)) {
      return { kind: "hold", reason: "settling" };
    }
    return { kind: "ready" };
  }

  private watchScreen(sessionId: string, data: string): void {
    const compact = data.replace(ANSI, "").replace(/\s+/g, "").toLowerCase();
    if (!compact) return;
    const tail = `${this.screenTails.get(sessionId) ?? ""}${compact}`.slice(-DIALOG_WINDOW);
    this.screenTails.set(sessionId, tail);
    const dialogAt = lastMatchEnd(tail, BLOCKING_DIALOGS);
    const readyAt = lastMatchEnd(tail, PROMPT_READY);
    if (dialogAt > readyAt) this.inDialog.add(sessionId);
    else if (readyAt > dialogAt) this.inDialog.delete(sessionId);
  }

  private prefixFor(request: DeliveryRequest): string {
    if (request.raw) return "";
    if (request.label) return `[${request.label}] `;
    if (!request.from) return "";
    const sender = this.options.sessions().find((session) => session.id === request.from);
    // ASCII around the name: a PowerShell target renders a middle dot as a blank.
    return sender ? `[from ${sessionLabel(sender)} (${sender.kind})] ` : "";
  }

  private settle(record: DeliveryRecord, state: Exclude<DeliveryState, "held">, reason: string | null): void {
    record.state = state;
    record.reason = reason;
    record.settledAt = this.now();
    this.urgent.delete(record.id);
    this.prefixes.delete(record.id);
    this.emit(record);
    const waiters = this.waiters.get(record.id);
    if (waiters) {
      this.waiters.delete(record.id);
      for (const waiter of [...waiters]) waiter({ ...record });
    }
    this.syncChip(record.to);
  }

  private syncChip(sessionId: string): void {
    const count = [...this.records.values()].filter((record) => record.state === "held" && record.to === sessionId).length;
    if (count > 0) this.options.setChip(sessionId, { key: HELD_CHIP_KEY, text: `보류 ${count}`, color: "amber" });
    else this.options.clearChips(sessionId, HELD_CHIP_KEY);
  }

  private emit(record: DeliveryRecord): void {
    for (const listener of this.listeners) listener({ ...record });
  }

  private prune(): void {
    const now = this.now();
    const settled = [...this.records.values()].filter((record) => record.state !== "held");
    for (const record of settled) {
      if (record.settledAt !== null && now - record.settledAt > KEEP_SETTLED_MS) this.records.delete(record.id);
    }
    const overflow = settled.length - MAX_SETTLED;
    for (const record of settled.slice(0, Math.max(0, overflow))) this.records.delete(record.id);
  }

  /** Time-based conditions (quiet windows, expiry) need a clock while anything is held. */
  private syncTicker(): void {
    const anyHeld = [...this.records.values()].some((record) => record.state === "held");
    if (anyHeld && this.ticker === null) {
      const set = this.options.setInterval ?? ((callback: () => void, ms: number) => setInterval(callback, ms));
      this.ticker = set(() => void this.pump(), TICK_MS);
      (this.ticker as { unref?: () => void } | null)?.unref?.();
    } else if (!anyHeld) {
      this.stopTicker();
    }
  }

  private stopTicker(): void {
    if (this.ticker === null) return;
    (this.options.clearInterval ?? ((handle: unknown) => clearInterval(handle as NodeJS.Timeout)))(this.ticker);
    this.ticker = null;
  }
}
