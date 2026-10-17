// @vitest-environment node

import { describe, expect, it } from "vitest";
import { HumanInputTracker } from "./human-input-tracker";

describe("HumanInputTracker", () => {
  it("counts typed characters and backspaces, and resets on Enter, Ctrl+C and Ctrl+U", () => {
    let now = 1;
    const tracker = new HumanInputTracker(() => now);
    tracker.note("s", "hello");
    expect(tracker.draft("s")).toEqual({ length: 5, lastInputAt: 1 });
    now = 2;
    tracker.note("s", "\u007f\u007f");
    expect(tracker.draft("s")).toEqual({ length: 3, lastInputAt: 2 });
    tracker.note("s", "\r");
    expect(tracker.draft("s").length).toBe(0);
    tracker.note("s", "ab\u0003");
    expect(tracker.draft("s").length).toBe(0);
    tracker.note("s", "ab\u0015");
    expect(tracker.draft("s").length).toBe(0);
  });

  it("ignores cursor keys and counts a bracketed paste's text", () => {
    const tracker = new HumanInputTracker(() => 0);
    tracker.note("s", "\u001b[A\u001b[D\u001bOH");
    expect(tracker.draft("s").length).toBe(0);
    tracker.note("s", "\u001b[200~ab\ncd\u001b[201~");
    expect(tracker.draft("s").length).toBe(5);
  });

  it("never goes below zero, keeps sessions apart, forgets, and notifies", () => {
    const tracker = new HumanInputTracker(() => 0);
    const changed: string[] = [];
    tracker.onChange((sessionId) => changed.push(sessionId));
    tracker.note("a", "\u007f\u007f");
    tracker.note("b", "xyz");
    expect(tracker.draft("a").length).toBe(0);
    expect(tracker.draft("b").length).toBe(3);
    tracker.forget("b");
    expect(tracker.draft("b")).toEqual({ length: 0, lastInputAt: null });
    expect(changed).toEqual(["a", "b"]);
  });
});
