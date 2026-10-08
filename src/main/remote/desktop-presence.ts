import type { DesktopPresence } from "../../shared/remote-types";

/** powerMonitor.getSystemIdleState의 결과. */
export type SystemIdleState = "active" | "idle" | "locked" | "unknown";

/** 이만큼 입력이 없으면 PC 앞에 없다고 본다. */
export const PRESENCE_IDLE_THRESHOLD_SECONDS = 120;

/**
 * 호스트 PC 앞에 사람이 있는지. 폰은 focused일 때만 알림을 생략한다 — 창에 포커스만 보면, 앱을 켜 둔 채
 * 자리를 비웠을 때 폰 알림이 영영 오지 않는다.
 */
export function desktopPresence(window: { visible: boolean; focused: boolean }, idle: SystemIdleState): DesktopPresence {
  if (idle !== "active") return "away";
  return window.focused ? "focused" : "active";
}
