import { expect, it } from "vitest";
import type { UsageSample } from "@shared/usage-types";
import { usageSegments } from "./usage-series";
it("breaks lines at resets, decreases, and collection gaps", () => {
  const now = Date.parse("2026-10-29T00:00:00Z");
  const sample = (minutes: number, usedPercent: number, resetsAt = "2026-10-29T05:00:00Z"): UsageSample => ({ provider: "codex", kind: "5h", observedAt: new Date(now + minutes * 60000).toISOString(), usedPercent, resetsAt });
  const segments = usageSegments([sample(0, 10), sample(5, 12), sample(10, 2), sample(30, 4), sample(35, 5, "2026-10-29T10:00:00Z")], "codex", "5h", now, now + 3600_000);
  expect(segments.map(segment => segment.length)).toEqual([2, 1, 1, 1]);
});
