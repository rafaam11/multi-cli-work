import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claudeThemeFor, createClaudeThemeSync, readUserClaudeTheme, watchUserClaudeSettings, type AppTheme } from "./claude-theme";

const roots: string[] = [];
async function configDir(settings?: unknown): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-claude-theme-"));
  roots.push(root);
  if (settings !== undefined) await fs.writeFile(path.join(root, "settings.json"), typeof settings === "string" ? settings : JSON.stringify(settings));
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("claudeThemeFor", () => {
  it("follows the app when the user never picked a Claude theme", () => {
    expect(claudeThemeFor("light", undefined)).toBe("light");
    expect(claudeThemeFor("dark", undefined)).toBe("dark");
  });

  it("keeps the user's colour-blind or ANSI family and only swaps light for dark", () => {
    expect(claudeThemeFor("light", "dark-daltonized")).toBe("light-daltonized");
    expect(claudeThemeFor("dark", "light-ansi")).toBe("dark-ansi");
    expect(claudeThemeFor("light", "dark")).toBe("light");
  });

  it("leaves a custom theme, or anything it does not recognise, to the user", () => {
    expect(claudeThemeFor("light", "custom:solarized")).toBeNull();
    expect(claudeThemeFor("light", "auto")).toBeNull();
    expect(claudeThemeFor("dark", 42)).toBeNull();
  });
});

describe("readUserClaudeTheme", () => {
  it("reads the theme Claude Code's /theme saved", async () => {
    expect(await readUserClaudeTheme(await configDir({ theme: "light-daltonized", model: "x" }))).toBe("light-daltonized");
  });

  it("treats a missing settings file, or one without a theme, as no choice", async () => {
    expect(await readUserClaudeTheme(await configDir())).toBeUndefined();
    expect(await readUserClaudeTheme(await configDir({ model: "x" }))).toBeUndefined();
  });

  it("leaves the theme alone when the settings file cannot be read — it may be half-written", async () => {
    const unreadable = await readUserClaudeTheme(await configDir("{ not json"));
    expect(claudeThemeFor("light", unreadable)).toBeNull();
  });
});

describe("watchUserClaudeSettings", () => {
  it("reports a /theme change made while the app runs, and stops when disposed", async () => {
    const dir = await configDir({ theme: "dark" });
    const changes: string[] = [];
    const stop = watchUserClaudeSettings(dir, () => changes.push("changed"));
    await fs.writeFile(path.join(dir, "history.jsonl"), "{}\n");
    await fs.writeFile(path.join(dir, "settings.json"), JSON.stringify({ theme: "dark-daltonized" }));
    await vi.waitFor(() => expect(changes.length).toBeGreaterThan(0), { timeout: 3000 });
    stop();
    const seen = changes.length;
    await fs.writeFile(path.join(dir, "settings.json"), JSON.stringify({ theme: "light" }));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(changes.length).toBe(seen);
  });

  it("does nothing for a config folder that does not exist", () => {
    const stop = watchUserClaudeSettings(path.join(os.tmpdir(), "mcw-no-such-claude-dir-0f3a"), () => undefined);
    expect(() => stop()).not.toThrow();
  });
});

describe("createClaudeThemeSync", () => {
  function harness(userConfigDir: string, initial: { enabled: boolean; theme: AppTheme }) {
    const state = { ...initial };
    const writes: Array<string | null> = [];
    const sync = createClaudeThemeSync({
      enabled: () => state.enabled,
      appTheme: () => state.theme,
      userConfigDir,
      write: async (theme) => {
        writes.push(theme);
      },
    });
    return { state, writes, sync };
  }

  it("writes the app's theme, then rewrites only when it changes", async () => {
    const { state, writes, sync } = harness(await configDir(), { enabled: true, theme: "dark" });
    await sync.sync();
    await sync.sync();
    state.theme = "light";
    await sync.sync();
    expect(writes).toEqual(["dark", "light"]);
  });

  it("drops the theme from the app's settings when the user turns the option off", async () => {
    const { state, writes, sync } = harness(await configDir(), { enabled: true, theme: "light" });
    await sync.sync();
    state.enabled = false;
    await sync.sync();
    expect(writes).toEqual(["light", null]);
  });

  it("never overrides a custom Claude theme", async () => {
    const { writes, sync } = harness(await configDir({ theme: "custom:mine" }), { enabled: true, theme: "light" });
    await sync.sync();
    expect(writes).toEqual([null]);
  });
});
