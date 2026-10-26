import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface InstallAttempt {
  from: string;
  to: string;
  at: string;
}

/**
 * Notes the version a restart is about to install.
 *
 * The NSIS installer runs with /S, so when it gives up (a file still held open, for one) nothing is
 * shown and the old version simply starts again. This note is how the next launch finds out.
 */
export function recordInstallAttempt(filePath: string, from: string, to: string, now: () => Date = () => new Date()): void {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const attempt: InstallAttempt = { from, to, at: now().toISOString() };
    writeFileSync(filePath, JSON.stringify(attempt), "utf8");
  } catch {
    // A note that cannot be written must not stop the install.
  }
}

/** Reads and removes the note — it is reported once. Returns it only when the install did not take. */
export function takeInstallAttempt(filePath: string, currentVersion: string): InstallAttempt | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    return null; // No restart-to-install happened.
  }
  rmSync(filePath, { force: true });
  try {
    const value = JSON.parse(raw) as Partial<InstallAttempt>;
    if (typeof value.from !== "string" || typeof value.to !== "string" || typeof value.at !== "string") return null;
    return value.to === currentVersion ? null : { from: value.from, to: value.to, at: value.at };
  } catch {
    return null;
  }
}
