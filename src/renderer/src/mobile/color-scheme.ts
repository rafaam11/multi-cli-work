/**
 * 원격 화면의 테마. 호스트가 미러로 자기 테마를 알려 주면 그것을 따르고 — 같은 앱의 두 창이 다른 색이면
 * 안 된다 — 알려 주지 않으면(구버전 호스트, 호스트 창 없음) 이 기기의 밝기 설정을 따른다(기본은 어둡게).
 */
let hostTheme: "dark" | "light" | null = null;

function deviceQuery(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: light)") : null;
}

function apply(): void {
  document.documentElement.dataset.theme = hostTheme ?? (deviceQuery()?.matches ? "light" : "dark");
}

/** 앱을 그리기 전에 한 번. 기기 설정이 바뀌면 호스트 테마가 없을 때만 따라간다. */
export function startColorScheme(): void {
  apply();
  deviceQuery()?.addEventListener("change", apply);
}

export function setHostTheme(theme: "dark" | "light" | null): void {
  hostTheme = theme;
  apply();
}
