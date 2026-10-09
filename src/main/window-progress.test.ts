import { describe, expect, it } from "vitest";
import { aggregateTaskbarProgress } from "./window-progress";

describe("aggregateTaskbarProgress", () => {
  it("shows nothing when no session reports progress", () => {
    expect(aggregateTaskbarProgress([])).toEqual({ value: -1, mode: "none" });
  });

  it("follows the furthest-behind determinate report", () => {
    expect(
      aggregateTaskbarProgress([
        { state: "normal", value: 80 },
        { state: "normal", value: 25 },
      ]),
    ).toEqual({ value: 0.25, mode: "normal" });
  });

  it("goes indeterminate when only an indeterminate report is running", () => {
    expect(aggregateTaskbarProgress([{ state: "indeterminate", value: null }])).toEqual({ value: 2, mode: "indeterminate" });
  });

  it("prefers a determinate value over an indeterminate one", () => {
    expect(
      aggregateTaskbarProgress([
        { state: "indeterminate", value: null },
        { state: "normal", value: 40 },
      ]),
    ).toEqual({ value: 0.4, mode: "normal" });
  });

  it("lets an error outrank a warning, and a warning outrank normal progress", () => {
    expect(
      aggregateTaskbarProgress([
        { state: "normal", value: 10 },
        { state: "warning", value: 60 },
        { state: "error", value: null },
      ]),
    ).toEqual({ value: 1, mode: "error" });
    expect(
      aggregateTaskbarProgress([
        { state: "normal", value: 10 },
        { state: "warning", value: 60 },
      ]),
    ).toEqual({ value: 0.6, mode: "paused" });
  });
});
