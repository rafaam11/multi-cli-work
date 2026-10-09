import type { SessionProgress } from "../shared/terminal-types";

/** Arguments for `BrowserWindow.setProgressBar`: -1 removes the bar, above 1 is indeterminate. */
export interface TaskbarProgress {
  value: number;
  mode: "none" | "normal" | "indeterminate" | "error" | "paused";
}

/**
 * One taskbar bar for every session's progress report. A failure is what the user most needs to
 * see, then a stall; otherwise the bar follows the session furthest from done.
 */
export function aggregateTaskbarProgress(progresses: readonly SessionProgress[]): TaskbarProgress {
  const error = progresses.find((progress) => progress.state === "error");
  if (error) return { value: fraction(error.value, 1), mode: "error" };
  const warning = progresses.find((progress) => progress.state === "warning");
  if (warning) return { value: fraction(warning.value, 1), mode: "paused" };
  const values = progresses.filter((progress) => progress.state === "normal").map((progress) => progress.value ?? 0);
  if (values.length > 0) return { value: Math.min(...values) / 100, mode: "normal" };
  if (progresses.length > 0) return { value: 2, mode: "indeterminate" };
  return { value: -1, mode: "none" };
}

function fraction(value: number | null, fallback: number): number {
  return value === null ? fallback : value / 100;
}
