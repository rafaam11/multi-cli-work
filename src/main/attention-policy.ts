import type { TerminalStatus } from "../shared/terminal-types";

export type WindowAttention = "none" | "input" | "approval";

export interface TerminalAttentionTracker {
  applyStatus(sessionId: string, status: TerminalStatus): WindowAttention;
  markSeen(sessionId: string | null): WindowAttention;
}

export function createTerminalAttentionTracker(): TerminalAttentionTracker {
  const unseen = new Map<string, WindowAttention>();
  const current = (): WindowAttention =>
    [...unseen.values()].includes("approval") ? "approval" : unseen.size > 0 ? "input" : "none";

  return {
    applyStatus(sessionId, status) {
      if (status === "awaiting-approval") unseen.set(sessionId, "approval");
      else if (status === "awaiting-input") unseen.set(sessionId, "input");
      else unseen.delete(sessionId);
      return current();
    },
    markSeen(sessionId) {
      if (sessionId) unseen.delete(sessionId);
      return current();
    },
  };
}
