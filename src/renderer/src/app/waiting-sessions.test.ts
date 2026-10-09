import { describe, expect, it } from "vitest";
import { nextWaitingSession, trackWaitingSince } from "./waiting-sessions";

const session = (id: string, status: string, updatedAt = "2026-10-09T00:00:00.000Z") =>
  ({ id, status, updatedAt }) as const;

describe("nextWaitingSession", () => {
  const sessions = [
    session("idle", "idle"),
    session("input-old", "awaiting-input"),
    session("input-new", "awaiting-input"),
    session("approval", "awaiting-approval"),
    session("working", "working"),
  ];
  const since = new Map([
    ["input-old", 100],
    ["input-new", 300],
    ["approval", 500],
  ]);

  it("goes to an approval first, then inputs oldest first, and cycles past the current one", () => {
    expect(nextWaitingSession(sessions, since, {}, null)).toBe("approval");
    expect(nextWaitingSession(sessions, since, {}, "approval")).toBe("input-old");
    expect(nextWaitingSession(sessions, since, {}, "input-old")).toBe("input-new");
    expect(nextWaitingSession(sessions, since, {}, "input-new")).toBe("approval");
    expect(nextWaitingSession(sessions, since, {}, "idle")).toBe("approval");
  });

  it("puts a session the user has not seen yet ahead of one already looked at", () => {
    expect(nextWaitingSession(sessions, since, { "input-new": "input" }, "approval")).toBe("input-new");
  });

  it("returns null when nothing waits", () => {
    expect(nextWaitingSession([session("a", "working")], new Map(), {}, null)).toBeNull();
  });
});

describe("trackWaitingSince", () => {
  it("stamps a session when it starts waiting and keeps the stamp while it waits", () => {
    const first = trackWaitingSince(new Map(), [session("a", "awaiting-input", "2026-10-09T00:00:01.000Z")], 9_000);
    expect(first.get("a")).toBe(Date.parse("2026-10-09T00:00:01.000Z"));
    const second = trackWaitingSince(first, [session("a", "awaiting-input", "2026-10-09T00:05:00.000Z")], 99_000);
    expect(second.get("a")).toBe(Date.parse("2026-10-09T00:00:01.000Z"));
  });

  it("forgets a session that stops waiting, and falls back to now for an unreadable time", () => {
    const waiting = trackWaitingSince(new Map(), [session("a", "awaiting-approval", "not a date")], 42);
    expect(waiting.get("a")).toBe(42);
    expect(trackWaitingSince(waiting, [session("a", "working")], 50).has("a")).toBe(false);
  });
});
