import type { SessionAttention } from "../shared/api-types";
import type { TerminalStatus } from "../shared/terminal-types";

export type WindowAttention = "none" | "input" | "approval";

export interface AttentionSnapshot {
  /** What the window frame should signal: the strongest wait among the unseen sessions. */
  window: WindowAttention;
  /** Every session that turned needy while off screen, and what it waits for. */
  unread: Record<string, SessionAttention>;
}

export interface TerminalAttentionTracker {
  applyStatus(sessionId: string, status: TerminalStatus): AttentionSnapshot;
  markSeen(sessionId: string | null): AttentionSnapshot;
  snapshot(): AttentionSnapshot;
}

/**
 * The unseen map is the unread state: a session enters when it starts waiting while off screen,
 * and leaves when the user opens it — or when the wait resolves on its own, because a badge for
 * a session that no longer needs anyone is a lie.
 */
export function createTerminalAttentionTracker(): TerminalAttentionTracker {
  const unseen = new Map<string, SessionAttention>();
  const snapshot = (): AttentionSnapshot => ({
    window: [...unseen.values()].includes("approval") ? "approval" : unseen.size > 0 ? "input" : "none",
    unread: Object.fromEntries(unseen),
  });

  return {
    applyStatus(sessionId, status) {
      if (status === "awaiting-approval") unseen.set(sessionId, "approval");
      else if (status === "awaiting-input") unseen.set(sessionId, "input");
      else unseen.delete(sessionId);
      return snapshot();
    },
    markSeen(sessionId) {
      if (sessionId) unseen.delete(sessionId);
      return snapshot();
    },
    snapshot,
  };
}
