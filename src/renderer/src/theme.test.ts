import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { applyStoredTheme, applyTheme, resolveTheme, THEME_STORAGE_KEY, useResolvedTheme } from "./theme";

afterEach(() => {
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

describe("theme", () => {
  it("resolves system against the OS preference and passes explicit choices through", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("writes data-theme and remembers it for the next first paint", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");

    delete document.documentElement.dataset.theme;
    applyStoredTheme();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("lets painters outside CSS follow a change", async () => {
    const { result } = renderHook(() => useResolvedTheme());
    expect(result.current).toBe("dark");
    await act(async () => {
      applyTheme("light");
      await Promise.resolve();
    });
    expect(result.current).toBe("light");
  });
});
