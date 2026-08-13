import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../shared/settings-types";
import { createSettingsService } from "./settings-store";

async function tempSettingsPath(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "settings-store-"));
  return path.join(dir, "settings.json");
}

describe("settings store", () => {
  it("파일이 없으면 기본값으로 시작한다", async () => {
    const service = await createSettingsService(await tempSettingsPath());
    expect(service.current()).toEqual(DEFAULT_SETTINGS);
  });

  it("부분 파일을 기본값 위에 관용적으로 얹는다", async () => {
    const settingsPath = await tempSettingsPath();
    await writeFile(settingsPath, JSON.stringify({ terminal: { fontSize: 20 }, legacyField: 1 }), "utf8");
    const service = await createSettingsService(settingsPath);
    expect(service.current().terminal.fontSize).toBe(20);
    expect(service.current().terminal.scrollback).toBe(10_000);
  });

  it("패치를 병합해 디스크에 쓰고 current()를 갱신한다", async () => {
    const settingsPath = await tempSettingsPath();
    const service = await createSettingsService(settingsPath);
    const next = await service.update({
      general: { closeToTray: false },
      keybindings: { "view.quick-open": "Ctrl+K" },
    });
    expect(next.general.closeToTray).toBe(false);
    expect(service.current()).toEqual(next);
    const written = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    expect(written).toMatchObject({
      general: { closeToTray: false },
      keybindings: { "view.quick-open": "Ctrl+K" },
    });
  });

  it("본문이 깨진 파일은 .bak으로 폴백한다", async () => {
    const settingsPath = await tempSettingsPath();
    const service = await createSettingsService(settingsPath);
    await service.update({ terminal: { fontSize: 18 } });
    await service.update({ terminal: { fontSize: 19 } }); // 두 번 써서 .bak이 확실히 존재하게 한다
    await writeFile(settingsPath, "{ corrupted", "utf8");
    const reopened = await createSettingsService(settingsPath);
    // .bak이 직전 상태(18)인지 최신 상태(19)인지는 json-store의 갱신 시점 규약을 따른다 —
    // 어느 쪽이든 기본값(13)으로 떨어지지 않았다는 것이 폴백의 증명이다.
    expect([18, 19]).toContain(reopened.current().terminal.fontSize);
  });
});
