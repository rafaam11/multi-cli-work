import { useEffect, useState } from "react";
import type { ThemePreference } from "@shared/settings-types";

export type ResolvedTheme = "dark" | "light";

/** Kept in localStorage too, so the first paint after a restart already has the right colours. */
export const THEME_STORAGE_KEY = "multi-cli-work.theme.v1";

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/** The one place the page's theme changes: CSS reads `data-theme`, JS readers watch it. */
export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* unavailable storage */
  }
}

/** Before React renders: whatever the last run resolved, so a light-theme user never sees a dark flash. */
export function applyStoredTheme(): void {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") document.documentElement.dataset.theme = stored;
  } catch {
    /* unavailable storage */
  }
}

export function currentTheme(): ResolvedTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/**
 * The resolved theme for components that paint outside CSS — xterm and Monaco take colours as
 * options. It follows `data-theme` rather than settings, so it cannot disagree with the stylesheet.
 */
export function useResolvedTheme(): ResolvedTheme {
  const [theme, setTheme] = useState<ResolvedTheme>(currentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    setTheme(currentTheme());
    return () => observer.disconnect();
  }, []);
  return theme;
}
