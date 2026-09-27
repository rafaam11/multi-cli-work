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
 * Light counterpart on --bg #f7f8f7. CLIs print "white" and "bright white" as body text on the
 * assumption of a dark background, so those two map to dark greys here; every colour keeps roughly
 * 4.5:1 against the background so agent output stays readable.
 */
const LIGHT: ITheme = {
  background: "#f7f8f7",
  foreground: "#1d2321",
  cursor: "#1b7867",
  cursorAccent: "#f7f8f7",
  selectionBackground: "#bfe0d8",
  black: "#1d2321",
  red: "#b33a3a",
  green: "#2d7a45",
  yellow: "#8a5d0c",
  blue: "#2c6aa3",
  magenta: "#7450a0",
  cyan: "#1b7867",
  white: "#4f5a55",
  brightBlack: "#66716c",
  brightRed: "#c0392b",
  brightGreen: "#237a3e",
  brightYellow: "#7a5200",
  brightBlue: "#1f5f99",
  brightMagenta: "#6a3fa0",
  brightCyan: "#136b5c",
  brightWhite: "#1d2321",
};

export function terminalTheme(theme: ResolvedTheme): ITheme {
  return theme === "light" ? LIGHT : DARK;
}
