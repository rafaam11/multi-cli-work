// @vitest-environment node

import { describe, expect, it } from "vitest";
import { parseProviderStatusEvent } from "./provider-status";

describe("provider status events", () => {
  it("accepts hook events with unified states", () => {
    expect(
      parseProviderStatusEvent({
        sessionId: "session-1",
        status: "awaiting-approval",
        event: "PermissionRequest",
        at: "2026-07-11T00:00:00.000Z",
      }),
    ).toEqual({
      sessionId: "session-1",
      status: "awaiting-approval",
      event: "PermissionRequest",
      at: "2026-07-11T00:00:00.000Z",
    });
  });

  it("rejects unsafe session ids and unknown states", () => {
    expect(() =>
      parseProviderStatusEvent({ sessionId: "../escape", status: "working", event: "Stop", at: "2026-07-11T00:00:00Z" }),
    ).toThrow(/session/i);
    expect(() =>
      parseProviderStatusEvent({ sessionId: "session-1", status: "paused", event: "Stop", at: "2026-07-11T00:00:00Z" }),
    ).toThrow(/status/i);
  });
});

