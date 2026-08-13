import type { SessionAttention } from "../shared/api-types";
import type { TerminalStatus } from "../shared/terminal-types";
import { DEFAULT_SETTINGS, type NotifiableStatus, type NotificationSettings } from "../shared/settings-types";
import { createTerminalAttentionTracker, type AttentionSnapshot } from "./attention-policy";
import { createTerminalNotificationDeduper, shouldShowTerminalStatusNotification } from "./notification-policy";

interface SessionSelection {
  selectedSessionId: string | null;
  visibleSessionIds: string[];
}

interface SessionAttentionControllerOptions {
  readSelection(): Promise<SessionSelection>;
  windowState(): { visible: boolean; focused: boolean };
  publish(snapshot: AttentionSnapshot): void;
  notify(sessionId: string, status: NotifiableStatus, onClick: () => void): void;
  navigate(sessionId: string): void;
  logError?(message: string, error: unknown): void;
  /** 없으면 기본값 — 설정 도입 전과 동일하게 동작한다(기존 테스트·호출부 보호). */
  notificationSettings?(): NotificationSettings;
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
      const notifications = options.notificationSettings?.() ?? DEFAULT_SETTINGS.notifications;
      const awaiting = status === "awaiting-input" || status === "awaiting-approval";
      const notifiable = awaiting || status === "exited" || status === "error";
      const wantsNotification =
        notifiable && notifications.desktop && notifications.statuses[status as NotifiableStatus];

      if (!awaiting) {
        // 배지·트레이는 알림 설정과 무관: 대기 상태만 attention을 세우고 나머지는 오늘처럼 지운다.
        deduper.reset(sessionId);
        publish(tracker.applyStatus(sessionId, status));
        if (!wantsNotification) return;
      }

      let selection: SessionSelection;
      try {
        selection = await options.readSelection();
      } catch (error) {
        options.logError?.("Failed to read the selected terminal session", error);
        selection = { selectedSessionId: null, visibleSessionIds: [] };
      }
      if (revisions.get(sessionId) !== revision) return;

      const window = options.windowState();
      const shouldNotify = shouldShowTerminalStatusNotification({
        eventSessionId: sessionId,
        selectedSessionId: selection.selectedSessionId,
        visibleSessionIds: selection.visibleSessionIds,
        windowVisible: window.visible,
        windowFocused: window.focused,
      });
      if (!shouldNotify) {
        deduper.reset(sessionId);
        if (awaiting) publish(tracker.markSeen(sessionId));
        return;
      }

      if (awaiting) publish(tracker.applyStatus(sessionId, status));
      if (!wantsNotification) return;
      if (!deduper.shouldNotify(sessionId, status)) return;
      options.notify(sessionId, status as NotifiableStatus, () => {
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
      const visible = new Set(
        [selection.selectedSessionId, ...selection.visibleSessionIds].filter((id): id is string => Boolean(id)),
      );
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
