import type { ITheme } from "@xterm/xterm";
import type { ResolvedTheme } from "./theme";

/** The terminal palette the app always had — tuned against --bg #161918. */
const DARK: ITheme = {
  background: "#161918",
  foreground: "#dfe5e1",
  cursor: "#4fb7a4",
  cursorAccent: "#161918",
  selectionBackground: "#355e56",
  black: "#202524",
  red: "#d46a6a",
  green: "#73b987",
  yellow: "#d8a24a",
  blue: "#6ea8d8",
  magenta: "#aa8ccc",
  cyan: "#4fb7a4",
  white: "#dfe5e1",
  brightBlack: "#69736e",
  brightRed: "#e78383",
  brightGreen: "#91cea0",
  brightYellow: "#e8ba6d",
  brightBlue: "#8abbe3",
  brightMagenta: "#bea2d2",
  brightCyan: "#78caba",
  brightWhite: "#ffffff",
};

/**
 * Light counterpart on --bg #ffffff, after GitHub's light terminal. CLIs print "white" and "bright
 * white" as body text on the assumption of a dark background, so those two map to dark greys here;
 * every colour keeps 4.5:1 against the background so agent output stays readable (theme-colors.test).
 */
const LIGHT: ITheme = {
  background: "#ffffff",
  foreground: "#1f2328",
  cursor: "#0969da",
  cursorAccent: "#ffffff",
  selectionBackground: "#b6e3ff",
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#9a6700",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#59636e",
  brightBlack: "#6e7781",
  brightRed: "#a40e26",
  brightGreen: "#1a7f37",
  brightYellow: "#7d4e00",
  brightBlue: "#0550ae",
  brightMagenta: "#6639ba",
  brightCyan: "#136061",
  brightWhite: "#1f2328",
};

export function terminalTheme(theme: ResolvedTheme): ITheme {
  return theme === "light" ? LIGHT : DARK;
}

/**
 * The palette above only covers the 16 ANSI colours. A CLI that paints with 24-bit colour picks
 * them for a dark background — white body text, pale greys — and on white that text all but
 * vanishes. On the light theme xterm darkens any glyph below 4.5:1 against the cell behind it; the
 * dark theme keeps every colour exactly as the CLI sent it.
 */
export function terminalMinimumContrast(theme: ResolvedTheme): number {
  return theme === "light" ? 4.5 : 1;
}
