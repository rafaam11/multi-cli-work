import type { AppSettings, AppSettingsPatch } from "../../shared/settings-types";
import { mergeSettingsPatch, parseSettings } from "../../shared/settings-types";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../storage/json-store";

class SettingsStoreError extends Error {}

/**
 * parseSettings never throws, so the only content error the backup path ever sees is broken JSON
 * syntax in the primary file — exactly the failure the .bak exists for.
 */
const spec: JsonStoreSpec<AppSettings> = {
  label: "settings store",
  parse: parseSettings,
  empty: () => parseSettings(undefined),
  error: (message, options) => new SettingsStoreError(message, options),
  isContentError: (error) => error instanceof SettingsStoreError,
};

export interface SettingsService {
  /** 동기 캐시 — close 핸들러·알림 경로처럼 await할 수 없는 게이트가 읽는다. */
  current(): AppSettings;
  update(patch: AppSettingsPatch): Promise<AppSettings>;
}

export async function createSettingsService(settingsPath: string): Promise<SettingsService> {
  let current = (await readJsonStore(spec, settingsPath)).value;
  return {
    current: () => current,
    async update(patch) {
      current = await updateJsonStore(spec, settingsPath, (value) => mergeSettingsPatch(value, patch));
      return current;
    },
  };
}
