import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettingsPatch, parseSettings } from "./settings-types";

describe("parseSettings", () => {
  it("빈 입력을 기본값으로 채운다 — settings.json 없는 기동은 오늘의 앱과 같다", () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("not an object")).toEqual(DEFAULT_SETTINGS);
  });

  it("현행 하드코딩 값이 그대로 기본값이다", () => {
    // TerminalPane.tsx 생성자·notification 정책·index.ts 트레이 동작의 현행 리터럴.
    // renderer-typography.test.ts가 CONTENT_TYPOGRAPHY(13/1.25)를 같은 값으로 고정하고 있다.
    expect(DEFAULT_SETTINGS.terminal).toEqual({
      fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 10_000,
      cursorStyle: "bar",
      cursorBlink: false,
    });
    expect(DEFAULT_SETTINGS.general).toEqual({
      closeToTray: true,
      autoResumeSessions: true,
      autoCheckUpdates: true,
    });
    expect(DEFAULT_SETTINGS.notifications).toEqual({
      desktop: true,
      statuses: { "awaiting-input": true, "awaiting-approval": true, exited: false, error: false },
    });
    expect(DEFAULT_SETTINGS.language).toBe("ko");
    expect(DEFAULT_SETTINGS.keybindings).toEqual({});
  });

  it("모르는 필드는 버리고, 범위 밖·타입 불일치 값은 필드 단위로 기본값에 되돌린다", () => {
    const parsed = parseSettings({
      language: "fr",
      unknownField: true,
      terminal: { fontSize: 200, scrollback: "많이", cursorStyle: "beam", fontFamily: "D2Coding" },
      notifications: { desktop: "yes", statuses: { exited: true } },
    });
    expect(parsed.language).toBe("ko");
    expect(parsed.terminal.fontSize).toBe(13);
    expect(parsed.terminal.scrollback).toBe(10_000);
    expect(parsed.terminal.cursorStyle).toBe("bar");
    expect(parsed.terminal.fontFamily).toBe("D2Coding");
    expect(parsed.notifications.desktop).toBe(true);
    expect(parsed.notifications.statuses.exited).toBe(true);
    expect("unknownField" in parsed).toBe(false);
  });

  it("keybindings는 짧은 문자열과 null만 남긴다", () => {
    const parsed = parseSettings({
      keybindings: { "view.quick-open": "Ctrl+K", "session.refresh": null, "view.zoom-in": 3 },
    });
    expect(parsed.keybindings).toEqual({ "view.quick-open": "Ctrl+K", "session.refresh": null });
  });
});

describe("mergeSettingsPatch", () => {
  it("부분 패치는 깊이 병합하고 keybindings는 통째로 교체한다", () => {
    const base = parseSettings({ keybindings: { "view.quick-open": "Ctrl+K" } });
    const merged = mergeSettingsPatch(base, {
      terminal: { fontSize: 16 },
      keybindings: { "session.refresh": null },
    });
    expect(merged.terminal.fontSize).toBe(16);
    expect(merged.terminal.lineHeight).toBe(1.25);
    expect(merged.keybindings).toEqual({ "session.refresh": null });
    expect(merged.general).toEqual(DEFAULT_SETTINGS.general);
  });

  it("keybindings가 빠진 패치는 기존 오버라이드를 유지한다", () => {
    const base = parseSettings({ keybindings: { "view.quick-open": "Ctrl+K" } });
    const merged = mergeSettingsPatch(base, { language: "en" });
    expect(merged.keybindings).toEqual({ "view.quick-open": "Ctrl+K" });
    expect(merged.language).toBe("en");
  });
});
