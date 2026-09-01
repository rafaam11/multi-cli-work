import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";

/** electron-updater's logger shape. `debug` is optional there, so it is optional here too. */
export interface UpdaterLogger {
  info(message?: unknown): void;
  warn(message?: unknown): void;
  error(message?: unknown): void;
  debug?(message: string): void;
}

const DEFAULT_LIMIT_BYTES = 512 * 1024;

function render(value: unknown): string {
  // The stack is what makes an entry actionable without reproducing the crash; fall back to
  // name+message only for the rare error that was constructed without one.
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  return typeof value === "string" ? value : String(value);
}

/**
 * Appends the updater's own narration to a file.
 *
 * Without this the updater is silent by construction: it runs the NSIS installer with /S, so a
 * failed install has no window to report from, and electron-updater's default logger is `console`,
 * which a packaged app throws away. A stalled update then looks exactly like no update at all.
 */
export function createUpdaterLogger(
  filePath: string,
  now: () => Date = () => new Date(),
  limitBytes: number = DEFAULT_LIMIT_BYTES,
): UpdaterLogger {
  const write = (level: string, message: unknown): void => {
    try {
      mkdirSync(path.dirname(filePath), { recursive: true });
      rollOver(filePath, limitBytes);
      appendFileSync(filePath, `${now().toISOString()} ${level} ${render(message)}\n`, "utf8");
    } catch {
      // A log that cannot be written must not take the update down with it.
    }
  };
  return {
    info: (message) => write("INFO ", message),
    warn: (message) => write("WARN ", message),
    error: (message) => write("ERROR", message),
    debug: (message) => write("DEBUG", message),
  };
}

/** One generation is enough: this file exists to explain the update that just ran, not its history. */
function rollOver(filePath: string, limitBytes: number): void {
  let size: number;
  try {
    size = statSync(filePath).size;
  } catch {
    return; // No file yet — nothing to roll.
  }
  if (size < limitBytes) return;
  renameSync(filePath, `${filePath}.1`);
}
