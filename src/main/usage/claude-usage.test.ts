// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { claudeUsageAllowed, fetchClaudeUsage, parseClaudeUsage, readClaudeCredentials } from "./claude-usage";

const NOW = new Date("2026-10-09T03:00:00.000Z");

describe("readClaudeCredentials", () => {
  const file = (json: unknown) => vi.fn(async () => JSON.stringify(json));

  it("reads the OAuth token from CLAUDE_CONFIG_DIR, or ~/.claude", async () => {
    const readFile = file({ claudeAiOauth: { accessToken: "tok", expiresAt: 1_800_000_000_000, subscriptionType: "max" } });
    expect(await readClaudeCredentials({ CLAUDE_CONFIG_DIR: "/cfg" }, "/home/me", readFile)).toEqual({
      accessToken: "tok",
      expiresAt: 1_800_000_000_000,
      subscriptionType: "max",
    });
    expect(readFile).toHaveBeenCalledWith(expect.stringMatching(/cfg[\\/]\.credentials\.json$/), "utf8");
    await readClaudeCredentials({}, "/home/me", readFile);
    expect(readFile).toHaveBeenLastCalledWith(expect.stringMatching(/home[\\/]me[\\/]\.claude[\\/]\.credentials\.json$/), "utf8");
  });

  it("answers null for an API-key login, a missing file or a broken one", async () => {
    expect(await readClaudeCredentials({}, "/h", file({ apiKey: "x" }))).toBeNull();
    expect(await readClaudeCredentials({}, "/h", vi.fn(async () => Promise.reject(new Error("ENOENT"))))).toBeNull();
    expect(await readClaudeCredentials({}, "/h", vi.fn(async () => "{nope"))).toBeNull();
  });
});

describe("claudeUsageAllowed", () => {
  it("stays off when requests go to a gateway other than Anthropic's", () => {
    expect(claudeUsageAllowed({})).toBe(true);
    expect(claudeUsageAllowed({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" })).toBe(true);
    expect(claudeUsageAllowed({ ANTHROPIC_BASE_URL: "https://proxy.example.com" })).toBe(false);
  });
});

describe("parseClaudeUsage", () => {
  it("reads the five-hour and weekly windows", () => {
    expect(
      parseClaudeUsage(
        {
          five_hour: { utilization: 42.4, resets_at: "2026-10-09T05:00:00+00:00" },
          seven_day: { utilization: 81, resets_at: "2026-10-12T00:00:00Z" },
          seven_day_opus: null,
        },
        "max",
        NOW,
      ),
    ).toEqual({
      windows: [
        { kind: "5h", usedPercent: 42.4, resetsAt: "2026-10-09T05:00:00.000Z" },
        { kind: "weekly", usedPercent: 81, resetsAt: "2026-10-12T00:00:00.000Z" },
      ],
      plan: "max",
      updatedAt: NOW.toISOString(),
    });
  });

  it("answers null when the shape is not what it knows, so the gauge hides instead of lying", () => {
    expect(parseClaudeUsage({ unexpected: true }, null, NOW)).toBeNull();
    expect(parseClaudeUsage(null, null, NOW)).toBeNull();
    expect(parseClaudeUsage({ five_hour: { utilization: "lots" } }, null, NOW)).toBeNull();
  });

  it("clamps the percentage and tolerates a missing reset time", () => {
    expect(parseClaudeUsage({ five_hour: { utilization: 130, resets_at: null } }, null, NOW)?.windows).toEqual([
      { kind: "5h", usedPercent: 100, resetsAt: null },
    ]);
  });
});

describe("fetchClaudeUsage", () => {
  it("sends the token only as a bearer header and reports Retry-After", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 429, headers: { "Retry-After": "120" } }));
    expect(await fetchClaudeUsage(fetchFn, "secret-token")).toEqual({ status: 429, retryAfterSec: 120, json: null });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/api/oauth/usage");
    expect(init.headers).toMatchObject({ Authorization: "Bearer secret-token", "anthropic-beta": "oauth-2025-04-20" });
  });

  it("returns the body of a successful answer", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ five_hour: { utilization: 1 } }), { status: 200 }));
    expect(await fetchClaudeUsage(fetchFn, "t")).toEqual({ status: 200, retryAfterSec: null, json: { five_hour: { utilization: 1 } } });
  });
});
