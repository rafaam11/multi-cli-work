import { describe, expect, it, vi } from "vitest";
import { SessionIndicatorTracker } from "./session-indicators";

const progress = (body: string) => `\u001b]9;4;${body}\u0007`;
const data = (sessionId: string, text: string) => ({ type: "data" as const, sessionId, data: text, sequence: 1 });

describe("SessionIndicatorTracker", () => {
  it("publishes a session's progress as its output reports it, once per change", () => {
    const tracker = new SessionIndicatorTracker();
    const listener = vi.fn();
    tracker.onChange(listener);

    tracker.handle(data("a", `step ${progress("1;10")} ${progress("1;20")}`));
    tracker.handle(data("a", progress("1;20")));
    tracker.handle(data("b", "plain output"));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      sessionId: "a",
      indicators: { progress: { state: "normal", value: 20 }, chips: [] },
    });
    expect(tracker.snapshot()).toEqual([
      { sessionId: "a", indicators: { progress: { state: "normal", value: 20 }, chips: [] } },
    ]);
  });

  it("keeps each session's split sequences apart", () => {
    const tracker = new SessionIndicatorTracker();
    tracker.handle(data("a", "\u001b"));
    tracker.handle(data("a", "]9;4;1;"));
    tracker.handle(data("b", "\u001b]9;4;3;"));
    tracker.handle(data("a", "60\u0007"));
    tracker.handle(data("b", "\u0007"));
    expect(tracker.snapshot()).toEqual([
      { sessionId: "a", indicators: { progress: { state: "normal", value: 60 }, chips: [] } },
      { sessionId: "b", indicators: { progress: { state: "indeterminate", value: null }, chips: [] } },
    ]);
  });

  it("clears a report the session clears, and one left behind when the session stops working", () => {
    const tracker = new SessionIndicatorTracker();
    const listener = vi.fn();
    tracker.onChange(listener);

    tracker.handle(data("a", progress("1;50")));
    tracker.handle(data("a", progress("0")));
    expect(listener).toHaveBeenLastCalledWith({ sessionId: "a", indicators: { progress: null, chips: [] } });

    tracker.handle(data("a", progress("3;")));
    tracker.handle({ type: "status", sessionId: "a", status: "working" });
    expect(tracker.snapshot()).toHaveLength(1);
    tracker.handle({ type: "status", sessionId: "a", status: "awaiting-input" });
    expect(tracker.snapshot()).toEqual([]);
    expect(listener).toHaveBeenLastCalledWith({ sessionId: "a", indicators: { progress: null, chips: [] } });
  });

  it("forgets everything about a session that exits or is removed", () => {
    const tracker = new SessionIndicatorTracker();
    tracker.handle(data("a", progress("1;5")));
    tracker.setChip("a", { key: "build", text: "빌드", color: "amber" });
    tracker.handle({ type: "exit", sessionId: "a", exitCode: 0 });
    expect(tracker.snapshot()).toEqual([]);

    tracker.handle(data("b", "\u001b]9;4;1;"));
    tracker.handle({ type: "removed", sessionId: "b" });
    tracker.handle(data("b", "7\u0007"));
    expect(tracker.snapshot()).toEqual([]);
  });

  it("lets a progress set from the CLI win over the one the output reports, until it is cleared", () => {
    const tracker = new SessionIndicatorTracker();
    tracker.handle(data("a", progress("1;10")));
    tracker.setProgress("a", { state: "warning", value: 80 });
    tracker.handle(data("a", progress("1;30")));
    expect(tracker.get("a").progress).toEqual({ state: "warning", value: 80 });
    tracker.setProgress("a", null);
    expect(tracker.get("a").progress).toEqual({ state: "normal", value: 30 });
  });

  it("keeps chips in the order they were first set, replacing by key, and clears one or all", () => {
    const tracker = new SessionIndicatorTracker();
    tracker.setChip("a", { key: "tests", text: "12/40", color: "blue" });
    tracker.setChip("a", { key: "build", text: "빌드 중", color: "amber" });
    tracker.setChip("a", { key: "tests", text: "40/40", color: "green" });
    expect(tracker.get("a").chips).toEqual([
      { key: "tests", text: "40/40", color: "green" },
      { key: "build", text: "빌드 중", color: "amber" },
    ]);
    tracker.clearChips("a", "tests");
    expect(tracker.get("a").chips.map((chip) => chip.key)).toEqual(["build"]);
    tracker.clearChips("a");
    expect(tracker.get("a")).toEqual({ progress: null, chips: [] });
  });
});
