import { describe, expect, it } from "vitest";
import { createTerminalAttentionTracker } from "./attention-policy";

describe("terminal attention tracker", () => {
  it("keeps an unseen wait visible until its session is seen or resumes", () => {
    const tracker = createTerminalAttentionTracker();

    expect(tracker.applyStatus("codex-1", "awaiting-input")).toBe("input");
    expect(tracker.markSeen("claude-1")).toBe("input");
    expect(tracker.markSeen("codex-1")).toBe("none");
    expect(tracker.applyStatus("codex-1", "awaiting-input")).toBe("input");
    expect(tracker.applyStatus("codex-1", "working")).toBe("none");
  });

  it("gives an unseen approval precedence over input from another session", () => {
    const tracker = createTerminalAttentionTracker();

    tracker.applyStatus("codex-1", "awaiting-input");
    expect(tracker.applyStatus("claude-1", "awaiting-approval")).toBe("approval");
    expect(tracker.markSeen("claude-1")).toBe("input");
  });
});
