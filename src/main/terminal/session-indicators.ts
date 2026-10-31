import type {
  SessionIndicators,
  SessionIndicatorsUpdate,
  SessionProgress,
  StatusChip,
  TerminalEvent,
  TerminalStatus,
} from "../../shared/terminal-types";
import { createOscProgressScanner, type OscProgressScanner } from "./osc-progress";

/** A session that leaves these states has finished whatever it was reporting progress on. */
const REPORTING_STATUSES: ReadonlySet<TerminalStatus> = new Set(["starting", "working"]);

const EMPTY: SessionIndicators = { progress: null, chips: [] };

/**
 * What each pane shows beside its status — the progress its output reports (`OSC 9;4`) or a script
 * set with `jk progress`, and the chips pinned with `jk status set`. All of it is ephemeral: it
 * describes what a running session is doing right now, so it dies with the session.
 */
export class SessionIndicatorTracker {
  private readonly scanners = new Map<string, OscProgressScanner>();
  private readonly reported = new Map<string, SessionProgress>();
  private readonly pinned = new Map<string, SessionProgress>();
  private readonly chips = new Map<string, StatusChip[]>();
  private readonly published = new Map<string, SessionIndicators>();
  private readonly listeners = new Set<(update: SessionIndicatorsUpdate) => void>();

  handle(event: TerminalEvent): void {
    switch (event.type) {
      case "data": {
        let scanner = this.scanners.get(event.sessionId);
        if (!scanner) {
          // The common case: nothing to look at. A chunk ending mid-introducer may still start one.
          if (!event.data.includes("\u001b]9") && !/\u001b\]?$/.test(event.data)) return;
          scanner = createOscProgressScanner();
          this.scanners.set(event.sessionId, scanner);
        }
        const updates = scanner.scan(event.data);
        if (updates.length === 0) return;
        const last = updates[updates.length - 1];
        if (last) this.reported.set(event.sessionId, last);
        else this.reported.delete(event.sessionId);
        this.emit(event.sessionId);
        return;
      }
      case "status":
        if (REPORTING_STATUSES.has(event.status) || !this.reported.has(event.sessionId)) return;
        this.reported.delete(event.sessionId);
        this.emit(event.sessionId);
        return;
      case "exit":
      case "removed":
        this.forget(event.sessionId);
        return;
      default:
        return;
    }
  }

  setProgress(sessionId: string, progress: SessionProgress | null): void {
    if (progress) this.pinned.set(sessionId, progress);
    else this.pinned.delete(sessionId);
    this.emit(sessionId);
  }

  setChip(sessionId: string, chip: StatusChip): void {
    const current = this.chips.get(sessionId) ?? [];
    const index = current.findIndex((candidate) => candidate.key === chip.key);
    this.chips.set(sessionId, index === -1 ? [...current, chip] : current.map((old, at) => (at === index ? chip : old)));
    this.emit(sessionId);
  }

  /** Clears one chip by key, or every chip of the session. */
  clearChips(sessionId: string, key?: string): void {
    const current = this.chips.get(sessionId) ?? [];
    const next = key === undefined ? [] : current.filter((chip) => chip.key !== key);
    if (next.length > 0) this.chips.set(sessionId, next);
    else this.chips.delete(sessionId);
    this.emit(sessionId);
  }

  get(sessionId: string): SessionIndicators {
    return this.published.get(sessionId) ?? EMPTY;
  }

  /** Every session that shows something right now. */
  snapshot(): SessionIndicatorsUpdate[] {
    return [...this.published].map(([sessionId, indicators]) => ({ sessionId, indicators }));
  }

  onChange(listener: (update: SessionIndicatorsUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private forget(sessionId: string): void {
    this.scanners.delete(sessionId);
    this.reported.delete(sessionId);
    this.pinned.delete(sessionId);
    this.chips.delete(sessionId);
    this.emit(sessionId);
  }

  private emit(sessionId: string): void {
    const next: SessionIndicators = {
      progress: this.pinned.get(sessionId) ?? this.reported.get(sessionId) ?? null,
      chips: this.chips.get(sessionId) ?? [],
    };
    const previous = this.get(sessionId);
    if (sameIndicators(previous, next)) return;
    if (next.progress === null && next.chips.length === 0) this.published.delete(sessionId);
    else this.published.set(sessionId, next);
    for (const listener of this.listeners) listener({ sessionId, indicators: next });
  }
}

function sameIndicators(a: SessionIndicators, b: SessionIndicators): boolean {
  return (
    a.progress?.state === b.progress?.state &&
    a.progress?.value === b.progress?.value &&
    a.chips.length === b.chips.length &&
    a.chips.every(
      (chip, index) => chip.key === b.chips[index].key && chip.text === b.chips[index].text && chip.color === b.chips[index].color,
    )
  );
}
