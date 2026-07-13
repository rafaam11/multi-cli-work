import { describe, expect, it } from "vitest";
import { createTerminalAttentionTracker } from "./attention-policy";

describe("terminal attention tracker", () => {
  it("keeps an unseen wait visible until its session is seen or resumes", () => {
    const tracker = createTerminalAttentionTracker();

    expect(tracker.applyStatus("codex-1", "awaiting-input").window).toBe("input");
    expect(tracker.markSeen("claude-1").window).toBe("input");
    expect(tracker.markSeen("codex-1").window).toBe("none");
    expect(tracker.applyStatus("codex-1", "awaiting-input").window).toBe("input");
    expect(tracker.applyStatus("codex-1", "working").window).toBe("none");
  });

  it("gives an unseen approval precedence over input from another session", () => {
    const tracker = createTerminalAttentionTracker();

    tracker.applyStatus("codex-1", "awaiting-input");
    expect(tracker.applyStatus("claude-1", "awaiting-approval").window).toBe("approval");
    expect(tracker.markSeen("claude-1").window).toBe("input");
  });

  it("reports each unseen session and what it waits for", () => {
    const tracker = createTerminalAttentionTracker();

    tracker.applyStatus("codex-1", "awaiting-input");
    expect(tracker.applyStatus("claude-1", "awaiting-approval").unread).toEqual({
      "codex-1": "input",
      "claude-1": "approval",
    });
    expect(tracker.markSeen("codex-1").unread).toEqual({ "claude-1": "approval" });
    expect(tracker.snapshot().unread).toEqual({ "claude-1": "approval" });
  });

  it("clears the unread flag when the wait resolves without being seen", () => {
    const tracker = createTerminalAttentionTracker();

    tracker.applyStatus("codex-1", "awaiting-input");
    expect(tracker.applyStatus("codex-1", "working").unread).toEqual({});
    tracker.applyStatus("codex-1", "awaiting-approval");
    expect(tracker.applyStatus("codex-1", "exited").unread).toEqual({});
  });
});
