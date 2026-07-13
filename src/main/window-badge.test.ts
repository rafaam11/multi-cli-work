import { describe, expect, it } from "vitest";
import type { AttentionSnapshot } from "./attention-policy";
import { attentionDotBitmap, taskbarBadgeSpec, trayTooltip } from "./window-badge";

const quiet: AttentionSnapshot = { window: "none", unread: {} };
const waiting: AttentionSnapshot = {
  window: "approval",
  unread: { "codex-1": "input", "claude-1": "approval" },
};

describe("attentionDotBitmap", () => {
  it("draws an opaque centre and transparent corners", () => {
    const size = 16;
    const bitmap = attentionDotBitmap(size, [0xd8, 0xa2, 0x4a]);
    expect(bitmap.length).toBe(size * size * 4);
    const centreOffset = (8 * size + 8) * 4;
    expect(bitmap[centreOffset + 3]).toBe(255);
    expect(bitmap[3]).toBe(0);
    expect(bitmap[bitmap.length - 1]).toBe(0);
  });
});

describe("taskbarBadgeSpec", () => {
  it("is absent while nothing waits", () => {
    expect(taskbarBadgeSpec(quiet)).toBeNull();
  });

  it("describes how many sessions wait", () => {
    const spec = taskbarBadgeSpec(waiting);
    expect(spec?.description).toBe("응답 대기 세션 2개");
    expect(spec?.bitmap.length).toBe(16 * 16 * 4);
    expect(spec?.bitmap2x.length).toBe(32 * 32 * 4);
  });
});

describe("trayTooltip", () => {
  it("stays the plain app name while nothing waits", () => {
    expect(trayTooltip(quiet)).toBe("멀티 터미널 작업기");
  });

  it("appends the waiting count", () => {
    expect(trayTooltip(waiting)).toBe("멀티 터미널 작업기 — 응답 대기 2개");
  });
});
