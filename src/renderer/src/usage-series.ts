import type { UsageSample, UsageWindowKind } from "@shared/usage-types";
/** A reset or a collection gap starts a new segment; neither is interpolated. */
export function usageSegments(samples: readonly UsageSample[], provider: UsageSample["provider"], kind: UsageWindowKind, since: number, until: number): UsageSample[][] {
  const points = samples.filter(sample => sample.provider === provider && sample.kind === kind && Date.parse(sample.observedAt) >= since && Date.parse(sample.observedAt) <= until)
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const segments: UsageSample[][] = [];
  for (const point of points) {
    const previous = segments.at(-1)?.at(-1);
    if (!previous || previous.resetsAt !== point.resetsAt || Date.parse(point.observedAt) - Date.parse(previous.observedAt) > 15 * 60_000 || point.usedPercent < previous.usedPercent) segments.push([]);
    segments.at(-1)!.push(point);
  }
  return segments;
}
