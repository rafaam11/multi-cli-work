// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupProviderStatusFiles, deleteProviderStatusFile, parseProviderStatusEvent } from "./provider-status";

const roots: string[] = [];

async function tempStatusDir(): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-provider-status-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("provider status events", () => {
  it("accepts hook events with unified states", () => {
    expect(
      parseProviderStatusEvent({
        sessionId: "session-1",
        status: "awaiting-approval",
        event: "PermissionRequest",
        at: "2026-07-11T00:00:00.000Z",
      }),
    ).toEqual({
      sessionId: "session-1",
      status: "awaiting-approval",
      event: "PermissionRequest",
      at: "2026-07-11T00:00:00.000Z",
    });
  });

  it("rejects unsafe session ids and unknown states", () => {
    expect(() =>
      parseProviderStatusEvent({ sessionId: "../escape", status: "working", event: "Stop", at: "2026-07-11T00:00:00Z" }),
    ).toThrow(/session/i);
    expect(() =>
      parseProviderStatusEvent({ sessionId: "session-1", status: "paused", event: "Stop", at: "2026-07-11T00:00:00Z" }),
    ).toThrow(/status/i);
  });
});

describe("deleteProviderStatusFile", () => {
  it("deletes the status file for a session", async () => {
    const dir = await tempStatusDir();
    await fs.writeFile(path.join(dir, "session-1.json"), "{}");

    await deleteProviderStatusFile(dir, "session-1");

    await expect(fs.stat(path.join(dir, "session-1.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does nothing when the status file is already missing", async () => {
    const dir = await tempStatusDir();

    await expect(deleteProviderStatusFile(dir, "session-missing")).resolves.toBeUndefined();
  });

  it("rejects unsafe session ids instead of touching the filesystem", async () => {
    const dir = await tempStatusDir();

    await expect(deleteProviderStatusFile(dir, "../escape")).rejects.toThrow(/session/i);
  });
});

describe("cleanupProviderStatusFiles", () => {
  it("removes status files whose session id is not in the keep set", async () => {
    const dir = await tempStatusDir();
    await fs.writeFile(path.join(dir, "keep-me.json"), "{}");
    await fs.writeFile(path.join(dir, "orphan.json"), "{}");

    await cleanupProviderStatusFiles(dir, new Set(["keep-me"]));

    expect(await fs.readdir(dir)).toEqual(["keep-me.json"]);
  });

  it("ignores non-json files and does nothing when the directory is missing", async () => {
    const dir = await tempStatusDir();
    await fs.writeFile(path.join(dir, "notes.txt"), "hello");

    await cleanupProviderStatusFiles(dir, new Set());
    expect(await fs.readdir(dir)).toEqual(["notes.txt"]);

    await expect(
      cleanupProviderStatusFiles(path.join(dir, "does-not-exist"), new Set()),
    ).resolves.toBeUndefined();
  });
});
