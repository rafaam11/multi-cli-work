/**
 * The app draws its own title bar, so the platform's caption bar has to go. How much of the frame
 * goes with it differs: Windows keeps the border, shadow, resize handles and drag snapping when
 * only the caption is hidden, which is strictly better than dropping the frame outright. Linux
 * ignores titleBarStyle entirely, so there the frame is the only lever.
 *
 * macOS is not a packaging target (see package.json build.win/build.linux); it falls into the
 * non-Windows branch and would lose its traffic lights, which is acceptable for a dev-only run.
 */
export type WindowChrome = Pick<Electron.BrowserWindowConstructorOptions, "frame" | "titleBarStyle">;

export function windowChromeOptions(platform: NodeJS.Platform): WindowChrome {
  return platform === "win32" ? { titleBarStyle: "hidden" } : { frame: false };
}
