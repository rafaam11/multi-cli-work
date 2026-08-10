import type { TerminalStatus } from "../shared/terminal-types";

interface TerminalStatusNotificationContext {
  eventSessionId: string;
  selectedSessionId: string | null;
  /** Every grid pane is on screen exactly like the selected session. */
  visibleSessionIds: readonly string[];
  windowVisible: boolean;
  windowFocused: boolean;
}

export function shouldShowTerminalStatusNotification(context: TerminalStatusNotificationContext): boolean {
  const onScreen =
    context.visibleSessionIds.includes(context.eventSessionId) ||
    context.eventSessionId === context.selectedSessionId;
  const sessionIsActivelyVisible = onScreen && context.windowVisible && context.windowFocused;
  return !sessionIsActivelyVisible;
}

export interface TerminalNotificationDeduper {
  shouldNotify(sessionId: string, status: TerminalStatus): boolean;
  reset(sessionId: string): void;
}

// Remembers the last status each session was notified for; the caller resets when the
// user sees the session (actively visible) or when the session leaves the wait states.
export function createTerminalNotificationDeduper(): TerminalNotificationDeduper {
  const lastNotifiedStatus = new Map<string, TerminalStatus>();
  return {
    shouldNotify(sessionId, status) {
      if (lastNotifiedStatus.get(sessionId) === status) return false;
      lastNotifiedStatus.set(sessionId, status);
      return true;
    },
    reset(sessionId) {
      lastNotifiedStatus.delete(sessionId);
    },
  };
}
