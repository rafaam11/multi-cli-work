import fs from "node:fs/promises";
import path from "node:path";

/**
 * Claude Code paints its own 24-bit colours from its own theme, so a dark-theme Claude in a light
 * app keeps drawing white text and dark boxes on white. Every Claude session the app starts reads
 * the app-owned `claude-settings.json` through `--settings`, and `theme` in that file wins over the
 * user's own setting for that session only — the user's Claude configuration is never written.
 * Measured on Claude Code 2.1.318: a running session keeps the theme it started with, so a switch
 * reaches new sessions only.
 */
export type AppTheme = "dark" | "light";

/** Claude Code's built-in presets: dark/light, each optionally colour-blind (daltonized) or ANSI-only. */
const PRESET = /^(?:dark|light)(-daltonized|-ansi)?$/;

/**
 * The theme the app's settings file should carry, or null to leave the user's choice alone. A user
 * who picked a colour-blind or ANSI preset keeps that family; a custom theme, or any value this does
 * not recognise (a newer "auto", say), is theirs and stays theirs.
 */
export function claudeThemeFor(appTheme: AppTheme, userTheme: unknown): string | null {
  if (userTheme === undefined) return appTheme;
  if (typeof userTheme !== "string") return null;
  const preset = PRESET.exec(userTheme);
  return preset ? `${appTheme}${preset[1] ?? ""}` : null;
}

/** The theme `/theme` saved in the user's Claude settings, or undefined when there is none. Read only. */
export async function readUserClaudeTheme(configDir: string): Promise<unknown> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(configDir, "settings.json"), "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).theme
      : undefined;
  } catch {
    return undefined;
  }
}

export interface ClaudeThemeSyncOptions {
  /** Settings > 일반: "Claude Code 화면도 앱 테마 따라가기". */
  enabled(): boolean;
  /** The app's resolved theme — "system" already turned into the OS's light or dark. */
  appTheme(): AppTheme;
  /** Where the user's Claude settings live (CLAUDE_CONFIG_DIR, or ~/.claude). */
  userConfigDir: string;
  /** Rewrites the app-owned Claude settings file with this theme, or with none. */
  write(theme: string | null): Promise<void>;
}

export interface ClaudeThemeSync {
  /** Brings the app's Claude settings in line with the current themes. Calls run one at a time. */
  sync(): Promise<void>;
}

export function createClaudeThemeSync(options: ClaudeThemeSyncOptions): ClaudeThemeSync {
  let written: string | null | undefined;
  let queue: Promise<void> = Promise.resolve();
  const run = async () => {
    const theme = options.enabled()
      ? claudeThemeFor(options.appTheme(), await readUserClaudeTheme(options.userConfigDir))
      : null;
    if (theme === written) return;
    await options.write(theme);
    written = theme;
  };
  return {
    sync() {
      queue = queue.then(run).catch((error: unknown) => {
        console.error("Failed to update the Claude Code theme for new sessions", error);
      });
      return queue;
    },
  };
}
