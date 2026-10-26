// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recordInstallAttempt, takeInstallAttempt } from "./update-attempt";

const AT = new Date("2026-10-26T12:00:00.000Z");

describe("install attempt", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "update-attempt-"));
    file = path.join(dir, "logs", "update-attempt.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports an install that left the old version running, once", () => {
    recordInstallAttempt(file, "1.50.1", "1.52.0", () => AT);
    expect(takeInstallAttempt(file, "1.50.1")).toEqual({ from: "1.50.1", to: "1.52.0", at: AT.toISOString() });
    expect(takeInstallAttempt(file, "1.50.1")).toBeNull();
  });

  it("says nothing when the new version is running", () => {
    recordInstallAttempt(file, "1.50.1", "1.52.0", () => AT);
    expect(takeInstallAttempt(file, "1.52.0")).toBeNull();
    expect(takeInstallAttempt(file, "1.52.0")).toBeNull();
  });

  it("says nothing without a note or with a broken one", () => {
    expect(takeInstallAttempt(file, "1.50.1")).toBeNull();
    recordInstallAttempt(file, "1.50.1", "1.52.0", () => AT);
    writeFileSync(file, "{not json", "utf8");
    expect(takeInstallAttempt(file, "1.50.1")).toBeNull();
    writeFileSync(file, JSON.stringify({ from: "1.50.1" }), "utf8");
    expect(takeInstallAttempt(file, "1.50.1")).toBeNull();
  });
});
