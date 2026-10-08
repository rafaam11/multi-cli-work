import { DEFAULT_SETTINGS, type AppSettings } from "@shared/settings-types";
import { useEffect, useState } from "react";
import { applyTheme, resolveTheme } from "../theme";

/** 앱 설정(변경 구독 포함), 그에 따른 테마, 그리고 앱 버전. */
export function useAppSettings() {
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [appVersion, setAppVersion] = useState("");

  // Only the 도움말 menu shows it, and it never changes while the app runs.
  useEffect(() => {
    void window.multiCliWork.updates.appVersion().then(setAppVersion).catch(() => undefined);
  }, []);

  // 기본값 = 현행 동작이므로 로드 전 잠깐 DEFAULT_SETTINGS로 그려도 시각적 차이가 없다.
  useEffect(() => {
    let disposed = false;
    void window.multiCliWork.settings
      .get()
      .then((settings) => {
        if (!disposed) setAppSettings(settings);
      })
      .catch(() => undefined);
    const unsubscribe = window.multiCliWork.settings.onChange(setAppSettings);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  // 테마: 설정이 "시스템"이면 OS의 밝기 설정을 따라가고, 그것이 바뀔 때도 따라간다.
  useEffect(() => {
    const preference = appSettings.appearance.theme;
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const apply = () => applyTheme(resolveTheme(preference, media?.matches ?? true));
    apply();
    if (preference !== "system" || !media) return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appSettings.appearance.theme]);

  return { appSettings, setAppSettings, appVersion };
}
