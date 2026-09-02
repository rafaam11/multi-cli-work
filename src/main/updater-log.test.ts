// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createUpdaterLogger } from "./updater-log";

const workspaces: string[] = [];

function tempLogPath(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "updater-log-"));
  workspaces.push(directory);
  // Nested on purpose: the updater writes before anything else creates userData/logs.
  return path.join(directory, "logs", "updater.log");
}

afterEach(() => {
  for (const directory of workspaces.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("updater log", () => {
  it("writes one timestamped line per level, creating the directory it needs", () => {
    const file = tempLogPath();
    const logger = createUpdaterLogger(file, () => new Date("2026-08-31T03:56:52.000Z"));

    logger.info("Checking for update");
    logger.warn("slow feed");
    logger.error(new Error("boom"));
    logger.debug?.("detail");

    const content = readFileSync(file, "utf8");
    expect(content).toContain("2026-08-31T03:56:52.000Z INFO  Checking for update\n");
    expect(content).toContain("2026-08-31T03:56:52.000Z WARN  slow feed\n");
    expect(content).toContain("2026-08-31T03:56:52.000Z DEBUG detail\n");
    // A silent installer only has this file to explain a failure — the stack, not just the
    // message, is what makes an entry actionable without reproducing the crash.
    expect(content).toContain("2026-08-31T03:56:52.000Z ERROR Error: boom\n    at ");
  });

  it("falls back to name and message when an error has no stack", () => {
    const file = tempLogPath();
    const logger = createUpdaterLogger(file, () => new Date("2026-08-31T03:56:52.000Z"));
    const stackless = new Error("boom");
    stackless.stack = undefined;

    logger.error(stackless);

    expect(readFileSync(file, "utf8")).toContain("2026-08-31T03:56:52.000Z ERROR Error: boom\n");
  });

  /** An update log nobody rotates is an update log that eventually fills the disk. */
  it("rolls the file over once it passes the size limit, keeping exactly one previous file", () => {
    const file = tempLogPath();
    const logger = createUpdaterLogger(file, () => new Date("2026-08-31T03:56:52.000Z"), 200);

    for (let index = 0; index < 40; index += 1) logger.info(`line ${index} ${"x".repeat(20)}`);

    expect(statSync(file).size).toBeLessThanOrEqual(200 + 200);
    expect(statSync(`${file}.1`).isFile()).toBe(true);
    // The newest line survives the rollover — that is the one being diagnosed.
    expect(readFileSync(file, "utf8")).toContain("line 39");
  });

  /** Logging is a diagnostic, never a reason for the updater itself to fail. */
  it("stays silent when the log cannot be written", () => {
    const file = tempLogPath();
    // A file where the directory has to go makes every write fail.
    writeFileSync(path.join(path.dirname(path.dirname(file)), "logs"), "not a directory");
    const logger = createUpdaterLogger(file, () => new Date("2026-08-31T03:56:52.000Z"));

    expect(() => logger.info("Checking for update")).not.toThrow();
    expect(() => logger.error(new Error("boom"))).not.toThrow();
  });
});
