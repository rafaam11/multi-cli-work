import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TEARDOWN_TIMEOUT_SEC,
  normalizeWorktreeScripts,
  parseWorktreeScripts,
  readWorktreeScripts,
  removeWorktreeScripts,
  setWorktreeScripts,
} from "./worktree-scripts";

let dir: string;
let registryPath: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-worktree-scripts-"));
  registryPath = path.join(dir, "worktree-scripts.json");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("worktree scripts store", () => {
  it("reads nothing for a folder that never had scripts", async () => {
    expect(await readWorktreeScripts("p1", { registryPath })).toBeNull();
  });

  it("stores each folder's scripts and drops the entry when both are emptied", async () => {
    await setWorktreeScripts("p1", { setup: "npm ci", teardown: "", teardownTimeoutSec: 60 }, { registryPath });
    await setWorktreeScripts("p2", { setup: "", teardown: "rm -rf .cache", teardownTimeoutSec: 30 }, { registryPath });
    expect(await readWorktreeScripts("p1", { registryPath })).toEqual({ setup: "npm ci", teardown: "", teardownTimeoutSec: 60 });

    await setWorktreeScripts("p1", { setup: "  ", teardown: "", teardownTimeoutSec: 60 }, { registryPath });
    expect(await readWorktreeScripts("p1", { registryPath })).toBeNull();
    expect(await readWorktreeScripts("p2", { registryPath })).not.toBeNull();

    await removeWorktreeScripts("p2", { registryPath });
    expect(await readWorktreeScripts("p2", { registryPath })).toBeNull();
  });
});

describe("normalizeWorktreeScripts", () => {
  it("accepts scripts within bounds and fills the default timeout", () => {
    expect(normalizeWorktreeScripts({ setup: "a", teardown: "b" })).toEqual({
      setup: "a",
      teardown: "b",
      teardownTimeoutSec: DEFAULT_TEARDOWN_TIMEOUT_SEC,
    });
  });

  it("rejects unknown fields, oversize scripts and timeouts out of range", () => {
    expect(() => normalizeWorktreeScripts({ setup: "", teardown: "", extra: 1 })).toThrow(/unknown fields/i);
    expect(() => normalizeWorktreeScripts({ setup: "x".repeat(16_385), teardown: "" })).toThrow(/16384/);
    expect(() => normalizeWorktreeScripts({ setup: "", teardown: "", teardownTimeoutSec: 0 })).toThrow(/timeout/i);
    expect(() => normalizeWorktreeScripts({ setup: "", teardown: "", teardownTimeoutSec: 3601 })).toThrow(/timeout/i);
  });
});

describe("parseWorktreeScripts", () => {
  it("rejects a file with an unknown schema", () => {
    expect(() => parseWorktreeScripts({ schemaVersion: 2, updatedAt: "2026-10-09T00:00:00.000Z", projects: {} })).toThrow(
      /schema/,
    );
  });
});
