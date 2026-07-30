import type { SessionAttention } from "../shared/api-types";
import type { TerminalStatus } from "../shared/terminal-types";
import { createTerminalAttentionTracker, type AttentionSnapshot } from "./attention-policy";
import { createTerminalNotificationDeduper, shouldShowTerminalStatusNotification } from "./notification-policy";

interface SessionSelection {
  selectedSessionId: string | null;
  splitSessionId: string | null;
}

interface SessionAttentionControllerOptions {
  readSelection(): Promise<SessionSelection>;
  windowState(): { visible: boolean; focused: boolean };
  publish(snapshot: AttentionSnapshot): void;
  notify(sessionId: string, status: "awaiting-input" | "awaiting-approval", onClick: () => void): void;
  navigate(sessionId: string): void;
  logError?(message: string, error: unknown): void;
}

export interface SessionAttentionController {
  handleStatus(sessionId: string, status: TerminalStatus): Promise<void>;
  clear(sessionId: string): void;
  markSeen(sessionId: string | null): void;
  markVisibleSessionsSeen(): Promise<void>;
  snapshot(): AttentionSnapshot;
}

/**
 * Serializes the asynchronous "is this session visible?" decision per session. A selection read
 * may finish after a newer provider status, so every decision carries a revision and is discarded
 * unless it is still the newest fact for that session.
 */
export function createSessionAttentionController(
  options: SessionAttentionControllerOptions,
): SessionAttentionController {
  const tracker = createTerminalAttentionTracker();
  const deduper = createTerminalNotificationDeduper();
  const revisions = new Map<string, number>();
  const bump = (sessionId: string) => {
    const next = (revisions.get(sessionId) ?? 0) + 1;
    revisions.set(sessionId, next);
    return next;
  };
  const publish = (snapshot: AttentionSnapshot) => options.publish(snapshot);

  const markSeen = (sessionId: string | null) => {
    if (sessionId) {
      bump(sessionId);
      deduper.reset(sessionId);
    }
    publish(tracker.markSeen(sessionId));
  };

  return {
    async handleStatus(sessionId, status) {
      const revision = bump(sessionId);
      if (status !== "awaiting-input" && status !== "awaiting-approval") {
        deduper.reset(sessionId);
        publish(tracker.applyStatus(sessionId, status));
        return;
      }

      let selection: SessionSelection;
      try {
        selection = await options.readSelection();
      } catch (error) {
        options.logError?.("Failed to read the selected terminal session", error);
        selection = { selectedSessionId: null, splitSessionId: null };
      }
      if (revisions.get(sessionId) !== revision) return;

      const window = options.windowState();
      const shouldNotify = shouldShowTerminalStatusNotification({
        eventSessionId: sessionId,
        selectedSessionId: selection.selectedSessionId,
        splitSessionId: selection.splitSessionId,
        windowVisible: window.visible,
        windowFocused: window.focused,
      });
      if (!shouldNotify) {
        deduper.reset(sessionId);
        publish(tracker.markSeen(sessionId));
        return;
      }

      publish(tracker.applyStatus(sessionId, status));
      if (!deduper.shouldNotify(sessionId, status)) return;
      options.notify(sessionId, status, () => {
        options.navigate(sessionId);
        markSeen(sessionId);
      });
    },
    clear(sessionId) {
      bump(sessionId);
      deduper.reset(sessionId);
      publish(tracker.applyStatus(sessionId, "exited"));
    },
    markSeen,
    async markVisibleSessionsSeen() {
      const selection = await options.readSelection();
      const visible = new Set([selection.selectedSessionId, selection.splitSessionId].filter(Boolean) as string[]);
      for (const sessionId of visible) {
        bump(sessionId);
        deduper.reset(sessionId);
        tracker.markSeen(sessionId);
      }
      publish(tracker.snapshot());
    },
    snapshot: () => tracker.snapshot(),
  };
}

export type { AttentionSnapshot, SessionAttention };
