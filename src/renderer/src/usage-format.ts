import type { UsageWindowKind } from "@shared/usage-types";

export type GaugeLevel = "ok" | "warn" | "high";

/** Green below 60%, amber below 85%, red from there — the gauge's colour. */
export function gaugeLevel(percent: number): GaugeLevel {
  if (percent >= 85) return "high";
  if (percent >= 60) return "warn";
  return "ok";
}

export function windowLabel(kind: UsageWindowKind): string {
  if (kind === "5h") return "5시간";
  if (kind === "weekly") return "주간";
  return "기타";
}

function span(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`;
  if (hours > 0) return rest > 0 ? `${hours}시간 ${rest}분` : `${hours}시간`;
  return `${rest}분`;
}

/** "2시간 13분 후 초기화" — null when the provider did not say when. */
export function resetText(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null;
  const left = Date.parse(resetsAt) - now;
  if (!Number.isFinite(left)) return null;
  if (left <= 0) return "초기화됨 — 다음 갱신 때 반영";
  if (left < 60_000) return "곧 초기화";
  return `${span(left)} 후 초기화`;
}

/** "12분 전 갱신" — Codex figures are only as fresh as its last turn, so this matters. */
export function ageText(updatedAt: string, now: number): string {
  const age = now - Date.parse(updatedAt);
  if (!Number.isFinite(age) || age < 60_000) return "방금 갱신";
  const minutes = Math.floor(age / 60_000);
  if (minutes < 60) return `${minutes}분 전 갱신`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전 갱신`;
  return `${Math.floor(hours / 24)}일 전 갱신`;
}
