import { describe, expect, it } from "vitest";
import { ageText, gaugeLevel, resetText, windowLabel } from "./usage-format";

const NOW = Date.parse("2026-10-09T03:00:00.000Z");

describe("gaugeLevel", () => {
  it("turns amber at 60% and red at 85%", () => {
    expect(gaugeLevel(59.9)).toBe("ok");
    expect(gaugeLevel(60)).toBe("warn");
    expect(gaugeLevel(84.9)).toBe("warn");
    expect(gaugeLevel(85)).toBe("high");
  });
});

describe("resetText", () => {
  it("says how long until the window resets", () => {
    expect(resetText("2026-10-09T05:13:00.000Z", NOW)).toBe("2시간 13분 후 초기화");
    expect(resetText("2026-10-09T03:40:00.000Z", NOW)).toBe("40분 후 초기화");
    expect(resetText("2026-10-12T05:00:00.000Z", NOW)).toBe("3일 2시간 후 초기화");
    expect(resetText("2026-10-09T03:00:20.000Z", NOW)).toBe("곧 초기화");
    expect(resetText("2026-10-09T02:00:00.000Z", NOW)).toBe("초기화됨 — 다음 갱신 때 반영");
    expect(resetText(null, NOW)).toBeNull();
  });
});

describe("ageText", () => {
  it("says how old the figures are", () => {
    expect(ageText("2026-10-09T02:59:40.000Z", NOW)).toBe("방금 갱신");
    expect(ageText("2026-10-09T02:48:00.000Z", NOW)).toBe("12분 전 갱신");
    expect(ageText("2026-10-08T22:00:00.000Z", NOW)).toBe("5시간 전 갱신");
    expect(ageText("2026-10-06T03:00:00.000Z", NOW)).toBe("3일 전 갱신");
  });
});

describe("windowLabel", () => {
  it("names the window", () => {
    expect(windowLabel("5h")).toBe("5시간");
    expect(windowLabel("weekly")).toBe("주간");
    expect(windowLabel("other")).toBe("기타");
  });
});
