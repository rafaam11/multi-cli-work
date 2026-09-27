// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createSummonShortcut, type GlobalShortcutApi } from "./summon-shortcut";

function fakeApi(taken: string[] = []) {
  const registered = new Map<string, () => void>();
  const api: GlobalShortcutApi = {
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (accelerator === "Bogus+") throw new Error("Failed to parse accelerator");
      if (taken.includes(accelerator)) return false;
      registered.set(accelerator, callback);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => {
      registered.delete(accelerator);
    }),
  };
  return { api, registered };
}

describe("createSummonShortcut", () => {
  it("registers the key, swaps it on change, and clears it with null", () => {
    const { api, registered } = fakeApi();
    const summon = vi.fn();
    const shortcut = createSummonShortcut(api, summon);

    expect(shortcut.apply("Ctrl+Alt+M")).toBe(true);
    registered.get("Ctrl+Alt+M")!();
    expect(summon).toHaveBeenCalledTimes(1);

    expect(shortcut.apply("Ctrl+Shift+Space")).toBe(true);
    expect([...registered.keys()]).toEqual(["Ctrl+Shift+Space"]);

    expect(shortcut.apply(null)).toBe(true);
    expect(registered.size).toBe(0);
    expect(shortcut.current()).toBeNull();
  });

  it("keeps the old key when the new one is taken or malformed", () => {
    const { api, registered } = fakeApi(["Ctrl+Alt+T"]);
    const shortcut = createSummonShortcut(api, () => undefined);
    shortcut.apply("Ctrl+Alt+M");

    expect(shortcut.apply("Ctrl+Alt+T")).toBe(false);
    expect(shortcut.apply("Bogus+")).toBe(false);
    expect(shortcut.current()).toBe("Ctrl+Alt+M");
    expect([...registered.keys()]).toEqual(["Ctrl+Alt+M"]);
  });

  it("does nothing when asked for the key it already holds", () => {
    const { api } = fakeApi();
    const shortcut = createSummonShortcut(api, () => undefined);
    shortcut.apply("Ctrl+Alt+M");
    shortcut.apply("Ctrl+Alt+M");
    expect(api.register).toHaveBeenCalledTimes(1);
  });
});
