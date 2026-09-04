import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, DEFAULT_PROJECT_CATEGORIES, mergeSettingsPatch, parseSettings } from "./settings-types";

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

describe("projects 구분 설정", () => {
  it("기본 구분 목록은 범용값이고 기본 구분은 '기타'이며 색 4개가 서로 다르다", () => {
    expect(DEFAULT_PROJECT_CATEGORIES.map((category) => category.name)).toEqual(["업무", "개인", "연구", "기타"]);
    expect(DEFAULT_SETTINGS.projects.defaultCategory).toBe("기타");
    const colors = DEFAULT_PROJECT_CATEGORIES.map((category) => category.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("projects가 없는 구버전 파일은 기본 구분 설정을 그대로 쓴다", () => {
    expect(parseSettings({}).projects).toEqual(DEFAULT_SETTINGS.projects);
  });

  it("이름 공백을 정리하고 중복을 버리며, 잘못된 색은 순환 기본값으로, 없는 기본 구분은 첫 항목으로 떨어진다", () => {
    const parsed = parseSettings({
      projects: {
        categories: [
          { name: " 업무 ", color: 2 },
          { name: "업무", color: 3 },
          { name: "", color: 1 },
          { name: "연구", color: 0 },
          { name: "기타", color: "파랑" },
        ],
        defaultCategory: "없는 것",
      },
    });
    expect(parsed.projects.categories).toEqual([
      { name: "업무", color: 2 },
      { name: "연구", color: 2 },
      { name: "기타", color: 3 },
    ]);
    expect(parsed.projects.defaultCategory).toBe("업무");
  });

  it("빈 구분 목록은 기본 목록으로 되돌아가고, 기본 목록에 있는 기본 구분은 유지된다", () => {
    const parsed = parseSettings({ projects: { categories: [], defaultCategory: "업무" } });
    expect(parsed.projects.categories).toEqual(DEFAULT_PROJECT_CATEGORIES);
    expect(parsed.projects.defaultCategory).toBe("업무");
  });

  it("patch로 지워진 기본 구분은 write 경로의 파서가 남은 목록의 첫 항목으로 되돌린다", () => {
    // json-store의 updateJsonStore가 mergeSettingsPatch 결과에도 parseSettings를 돌리므로,
    // 얕은 병합만으로 저장해도 디스크·current() 둘 다 정규화된 값을 갖는다.
    const merged = mergeSettingsPatch(DEFAULT_SETTINGS, {
      projects: { categories: [{ name: "업무", color: 1 }] },
    });
    expect(parseSettings(merged).projects.defaultCategory).toBe("업무");
  });

  it("projects 없는 패치는 기존 구분 목록을 유지한다", () => {
    const base = parseSettings({
      projects: { categories: [{ name: "커스텀", color: 3 }], defaultCategory: "커스텀" },
    });
    const merged = mergeSettingsPatch(base, { language: "en" });
    expect(merged.projects).toEqual(base.projects);
  });

  it("구분 이름은 32자로 잘린다", () => {
    const longName = "a".repeat(40);
    const parsed = parseSettings({ projects: { categories: [{ name: longName, color: 1 }] } });
    expect(parsed.projects.categories[0]!.name).toBe("a".repeat(32));
  });
});
