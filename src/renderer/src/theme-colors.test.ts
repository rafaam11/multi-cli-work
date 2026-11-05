import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { laneColor } from "./GitGraphSvg";
import { terminalTheme } from "./terminal-themes";

/*
 * The colour contract both themes share. The light theme is not the dark one with its values flipped:
 * it has its own strengths for washes, glows and shadows (--tint-scale, --glow-scale, --shadow-*), and
 * the rules below keep a new rule from slipping a dark-only colour back in.
 */

const SOURCE = resolve("src/renderer/src");
const themeCss = readFileSync(join(SOURCE, "theme-colors.css"), "utf8");
const indexCss = readFileSync(join(SOURCE, "index.css"), "utf8");
const mobileCss = readFileSync(join(SOURCE, "mobile/mobile.css"), "utf8");

function block(selector: string): Map<string, string> {
  const escaped = selector.replace(/[[\]"=]/g, (character) => `\\${character}`);
  const body = themeCss.match(new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`))?.[1];
  if (body === undefined) throw new Error(`theme-colors.css has no ${selector} block`);
  const tokens = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens.set(name, value.trim());
  return tokens;
}

const dark = block(":root");
const lightOverrides = block(':root[data-theme="light"]');

function value(theme: "dark" | "light", name: string, depth = 0): string {
  if (depth > 8) throw new Error(`--${name} refers to itself`);
  const raw = (theme === "light" ? lightOverrides.get(name) : undefined) ?? dark.get(name);
  if (raw === undefined) throw new Error(`--${name} is not defined`);
  const alias = raw.match(/^var\(--([\w-]+)\)$/);
  return alias ? value(theme, alias[1], depth + 1) : raw;
}

function channels(color: string): [number, number, number] {
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)?.[1];
  if (!hex) throw new Error(`not an opaque hex colour: ${color}`);
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)) as [number, number, number];
}

function luminance(color: string): number {
  const [r, g, b] = channels(color).map((channel) => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

/** Tokens that colour text, icons and rails — each has to read on every light surface. */
const FOREGROUNDS = [
  "text", "muted", "quiet", "accent", "teal", "amber", "blue", "red", "green", "violet",
  "category-government", "category-outsourcing", "category-research", "category-product", "category-etc",
  "accent-6", "accent-7", "danger-text", "warning-text", "gh-green", "gh-red", "gh-purple", "gh-yellow", "gh-blue",
];
const SURFACES = ["bg", "sidebar", "surface", "header-bg"];

describe("theme colour tokens", () => {
  it("gives every token a light value, apart from fixed brand colours and tokens built from others", () => {
    const derived = (name: string) => {
      const raw = dark.get(name) ?? "";
      return raw.includes("var(--") && !/#[0-9a-f]{3,8}\b|rgba?\(\s*\d/i.test(raw);
    };
    const missing = [...dark.keys()].filter((name) => !name.startsWith("brand-") && !derived(name) && !lightOverrides.has(name));
    expect(missing).toEqual([]);
  });

  it("defines the strength tokens the light theme turns down", () => {
    for (const name of ["accent", "on-accent", "on-danger", "on-warning", "tint-scale", "glow-scale", "shadow-rgb", "shadow-scale", "backdrop",
      "diff-add-bg", "diff-del-bg", "diff-hunk-bg"]) {
      expect(dark.has(name), `--${name} in :root`).toBe(true);
      expect(lightOverrides.has(name), `--${name} in light`).toBe(true);
    }
  });

  it("keeps light foreground colours at 4.5:1 on every light surface", () => {
    const failures: string[] = [];
    for (const foreground of FOREGROUNDS) {
      for (const surface of SURFACES) {
        const ratio = contrast(value("light", foreground), value("light", surface));
        if (ratio < 4.5) failures.push(`--${foreground} on --${surface}: ${ratio.toFixed(2)}`);
      }
    }
    for (const foreground of ["text", "muted", "accent"]) {
      const ratio = contrast(value("light", foreground), value("light", "surface-hover"));
      if (ratio < 4.5) failures.push(`--${foreground} on --surface-hover: ${ratio.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });

  it("keeps text on a solid accent fill readable in both themes", () => {
    expect(contrast(value("light", "on-accent"), value("light", "accent"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(value("dark", "on-accent"), value("dark", "accent"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("stylesheets", () => {
  /** Custom properties a rule or a component sets, as opposed to the shared tokens. */
  function declaredProperties(): Set<string> {
    const names = new Set<string>();
    for (const css of [themeCss, indexCss, mobileCss]) {
      for (const [, name] of css.matchAll(/(--[\w-]+)\s*:/g)) names.add(name);
    }
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          for (const [, name] of readFileSync(path, "utf8").matchAll(/["'`](--[\w-]+)["'`]/g)) names.add(name);
        }
      }
    };
    walk(SOURCE);
    return names;
  }

  it("only reads custom properties something defines", () => {
    const declared = declaredProperties();
    const undefinedReads = new Set<string>();
    for (const css of [indexCss, mobileCss]) {
      // A var() with a fallback is safe either way; one without falls back to nothing.
      for (const [, name] of css.matchAll(/var\((--[\w-]+)\s*\)/g)) if (!declared.has(name)) undefinedReads.add(name);
    }
    expect([...undefinedReads]).toEqual([]);
  });

  it("writes no theme-blind colours by hand", () => {
    const offenders: string[] = [];
    for (const [file, css] of [["index.css", indexCss], ["mobile.css", mobileCss]] as const) {
      css.split(/\r?\n/).forEach((line, index) => {
        // A QR code stays black on white whatever the theme, or it does not scan.
        if (line.startsWith(".settings-remote-pairing img {")) return;
        // var(--token, #fallback) only applies when the token is missing.
        const stripped = line.replace(/var\(--[\w-]+,\s*#[0-9a-f]{3,8}\)/gi, "");
        if (/#[0-9a-f]{3,8}\b|rgba?\(\s*\d/i.test(stripped)) offenders.push(`${file}:${index + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe("git graph lanes", () => {
  it("draws every light lane at 3:1 or better against the light page", () => {
    const failures: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const ratio = contrast(laneColor(index, "light"), value("light", "bg"));
      if (ratio < 3) failures.push(`lane ${index}: ${ratio.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });

  it("keeps the dark lanes as they were", () => {
    expect(laneColor(0, "dark")).toBe("#4493f8");
    expect(laneColor(0)).toBe("#4493f8");
  });
});

describe("terminal palettes", () => {
  it("keeps every light ANSI colour readable on the light terminal background", () => {
    const light = terminalTheme("light");
    const background = light.background as string;
    const failures: string[] = [];
    for (const key of ["foreground", "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
      "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"] as const) {
      const ratio = contrast(light[key] as string, background);
      if (ratio < 4.5) failures.push(`${key}: ${ratio.toFixed(2)}`);
    }
    // Bright black is the "dim" colour — a hint, not body text.
    if (contrast(light.brightBlack as string, background) < 3) failures.push("brightBlack below 3:1");
    expect(failures).toEqual([]);
  });

  it("paints the light terminal with the light page background", () => {
    expect(terminalTheme("light").background).toBe(value("light", "bg"));
    expect(terminalTheme("dark").background).toBe(value("dark", "bg"));
  });
});
