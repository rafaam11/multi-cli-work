// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { latestRolloutFile, parseCodexRateLimits, readCodexUsage, readTailLines } from "./codex-usage";

const NOW = new Date("2026-10-09T03:00:00.000Z");
const tokenCount = (rateLimits: unknown, timestamp = "2026-10-09T02:00:00.000Z") =>
  JSON.stringify({ timestamp, type: "event_msg", payload: { type: "token_count", info: {}, rate_limits: rateLimits } });

describe("parseCodexRateLimits", () => {
  it("takes the last token_count that carries limits, telling windows apart by their length", () => {
    const lines = [
      tokenCount({ primary: { used_percent: 10, window_minutes: 300, resets_at: 1_791_645_428 }, secondary: null }),
      JSON.stringify({ type: "response_item", payload: {} }),
      tokenCount({
        primary: { used_percent: 54, window_minutes: 10080, resets_at: 1_791_645_428 },
        secondary: null,
        plan_type: "prolite",
      }),
      tokenCount(null),
    ];
    expect(parseCodexRateLimits(lines, NOW)).toEqual({
      windows: [{ kind: "weekly", usedPercent: 54, resetsAt: new Date(1_791_645_428_000).toISOString() }],
      plan: "prolite",
      updatedAt: "2026-10-09T02:00:00.000Z",
    });
  });

  it("reads both windows and the older resets_in_seconds form, relative to the line's time", () => {
    const usage = parseCodexRateLimits(
      [
        tokenCount({
          primary: { used_percent: 20, window_minutes: 300, resets_in_seconds: 3_600 },
          secondary: { used_percent: 70.5, window_minutes: 10080, resets_at: 1_791_645_428 },
        }),
      ],
      NOW,
    );
    expect(usage?.windows).toEqual([
      { kind: "5h", usedPercent: 20, resetsAt: "2026-10-09T03:00:00.000Z" },
      { kind: "weekly", usedPercent: 70.5, resetsAt: new Date(1_791_645_428_000).toISOString() },
    ]);
  });

  it("answers null when no line carries limits, skipping lines that are not JSON", () => {
    expect(parseCodexRateLimits(["{broken", tokenCount(null)], NOW)).toBeNull();
  });
});

describe("rollout files", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-codex-usage-"));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("finds the newest rollout by date folder, then by modification time", async () => {
    const older = path.join(dir, "2026", "10", "07");
    const newer = path.join(dir, "2026", "10", "08");
    await fs.mkdir(older, { recursive: true });
    await fs.mkdir(newer, { recursive: true });
    await fs.writeFile(path.join(older, "rollout-a.jsonl"), "");
    await fs.writeFile(path.join(newer, "rollout-b.jsonl"), "");
    await fs.writeFile(path.join(newer, "rollout-c.jsonl"), "");
    await fs.writeFile(path.join(newer, "notes.txt"), "");
    const later = new Date(Date.now() + 60_000);
    await fs.utimes(path.join(newer, "rollout-b.jsonl"), later, later);
    expect(await latestRolloutFile(dir)).toBe(path.join(newer, "rollout-b.jsonl"));
    expect(await latestRolloutFile(path.join(dir, "missing"))).toBeNull();
  });

  it("reads only the tail of a long file, dropping the cut first line", async () => {
    const file = path.join(dir, "big.jsonl");
    await fs.writeFile(file, `${"x".repeat(5_000)}\nkeep-1\nkeep-2\n`);
    expect(await readTailLines(file, 20)).toEqual(["keep-1", "keep-2"]);
  });

  it("reads the usage out of the newest rollout", async () => {
    const day = path.join(dir, "2026", "10", "09");
    await fs.mkdir(day, { recursive: true });
    await fs.writeFile(
      path.join(day, "rollout-x.jsonl"),
      `${tokenCount({ primary: { used_percent: 33, window_minutes: 300, resets_at: 1_791_645_428 }, secondary: null })}\n`,
    );
    expect((await readCodexUsage(dir, NOW))?.windows[0]).toMatchObject({ kind: "5h", usedPercent: 33 });
  });
});
