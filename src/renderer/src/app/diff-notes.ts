import type { LineNote } from "@shared/line-notes";

/**
 * Notes left on the local diff pane (HEAD ↔ working tree), waiting to be sent to a session of the
 * same checkout. They are the user's own scratch and never leave this machine, so they live in the
 * renderer's localStorage — main never needs to know about them.
 */
export interface LocalDiffNote extends LineNote {
  id: string;
  /** `project:<id>` or `worktree:<id>` — the checkout the diff belongs to. */
  targetKey: string;
  status: "draft" | "sent";
  createdAt: number;
  sentAt: number | null;
}

export const DIFF_NOTES_STORAGE_KEY = "mcw.diffNotes.v1";
export const MAX_DIFF_NOTES = 300;
const SENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

const isNote = (value: unknown): value is LocalDiffNote => {
  if (typeof value !== "object" || value === null) return false;
  const note = value as Record<string, unknown>;
  return (
    typeof note.id === "string" &&
    typeof note.targetKey === "string" &&
    typeof note.path === "string" &&
    (note.side === "LEFT" || note.side === "RIGHT") &&
    typeof note.line === "number" &&
    Number.isInteger(note.line) &&
    note.line >= 1 &&
    typeof note.lineText === "string" &&
    typeof note.body === "string" &&
    (note.status === "draft" || note.status === "sent") &&
    typeof note.createdAt === "number" &&
    (note.sentAt === null || typeof note.sentAt === "number")
  );
};

/** What localStorage held; anything unreadable is dropped rather than trusted. */
export function parseDiffNotes(raw: string | null): LocalDiffNote[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; notes?: unknown };
    if (parsed.version !== 1 || !Array.isArray(parsed.notes)) return [];
    return parsed.notes.filter(isNote);
  } catch {
    return [];
  }
}

export function serializeDiffNotes(notes: readonly LocalDiffNote[]): string {
  return JSON.stringify({ version: 1, notes });
}

/**
 * Sent notes are kept a week (so "what did I ask for" still has an answer), notes of a checkout
 * that no longer exists go, and the total stays bounded — sent notes are let go before drafts.
 * `liveTargets` null means "not known yet": keep every target.
 */
export function pruneDiffNotes(
  notes: readonly LocalDiffNote[],
  now: number,
  liveTargets: ReadonlySet<string> | null,
): LocalDiffNote[] {
  const kept = notes.filter(
    (note) =>
      (liveTargets === null || liveTargets.has(note.targetKey)) &&
      !(note.status === "sent" && note.sentAt !== null && now - note.sentAt > SENT_RETENTION_MS),
  );
  if (kept.length <= MAX_DIFF_NOTES) return kept;
  const byAge = [...kept].sort((a, b) => (a.status === b.status ? a.createdAt - b.createdAt : a.status === "sent" ? -1 : 1));
  const drop = new Set(byAge.slice(0, kept.length - MAX_DIFF_NOTES).map((note) => note.id));
  return kept.filter((note) => !drop.has(note.id));
}
