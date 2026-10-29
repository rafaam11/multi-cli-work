// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupProviderStatusFiles, deleteProviderStatusFile, parseProviderStatusEvent, startProviderStatusWatcher, type ProviderStatusEvent } from "./provider-status";

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
  it("validates the optional Codex display metadata", () => {
    const event = { sessionId: "s", status: "working", event: "PreToolUse", at: "2026-01-01T00:00:00Z", model: "test", permissionMode: "plan", toolName: "Bash" };
    expect(parseProviderStatusEvent(event)).toMatchObject({ model: "test", permissionMode: "plan", toolName: "Bash" });
    expect(() => parseProviderStatusEvent({ ...event, model: "test\u001b[31m" })).toThrow();
    expect(() => parseProviderStatusEvent({ ...event, toolName: "x".repeat(201) })).toThrow();
  });
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

  it("accepts exact provider ownership metadata from SessionStart", () => {
    expect(parseProviderStatusEvent({
      sessionId: "session-1",
      status: "working",
      event: "SessionStart",
      at: "2026-07-30T00:00:00.000Z",
      providerConversationId: "conversation-1",
      transcriptPath: "C:\\Users\\me\\.codex\\sessions\\exact.jsonl",
    })).toMatchObject({
      providerConversationId: "conversation-1",
      transcriptPath: "C:\\Users\\me\\.codex\\sessions\\exact.jsonl",
    });
    expect(() => parseProviderStatusEvent({
      sessionId: "session-1", status: "working", event: "SessionStart", at: "2026-07-30T00:00:00.000Z",
      providerConversationId: "",
    })).toThrow(/conversation/i);
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
    await fs.writeFile(path.join(dir, "session-1.start.json"), "{}");

    await deleteProviderStatusFile(dir, "session-1");

    await expect(fs.stat(path.join(dir, "session-1.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(dir, "session-1.start.json"))).rejects.toMatchObject({ code: "ENOENT" });
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
    await fs.writeFile(path.join(dir, "keep-me.start.json"), "{}");
    await fs.writeFile(path.join(dir, "orphan.json"), "{}");
    await fs.writeFile(path.join(dir, "orphan.start.json"), "{}");

    await cleanupProviderStatusFiles(dir, new Set(["keep-me"]));

    expect(await fs.readdir(dir)).toEqual(["keep-me.json", "keep-me.start.json"]);
  });

  it("sweeps hook temp files a crashed or raced write left behind, but not one being written now", async () => {
    const dir = await tempStatusDir();
    const stale = path.join(dir, "abc.json.1234.tmp");
    const fresh = path.join(dir, "abc.json.5678.tmp");
    await fs.writeFile(stale, "{}");
    await fs.writeFile(fresh, "{}");
    const now = Date.now();
    const old = new Date(now - 5 * 60_000);
    await fs.utimes(stale, old, old);

    await cleanupProviderStatusFiles(dir, new Set(), now);

    expect(await fs.readdir(dir)).toEqual(["abc.json.5678.tmp"]);
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

describe("startProviderStatusWatcher", () => {
  it("does not replay ownership from another generation and only replays a matching start once", async () => {
    const dir = await tempStatusDir();
    const start = { sessionId: "s", provider: "codex", generation: "current", providerConversationId: "conversation", status: "working", event: "SessionStart", at: "2026-10-28T00:00:00Z" };
    const latest = { ...start, event: "PreToolUse" };
    await fs.writeFile(path.join(dir, "s.start.json"), JSON.stringify({ ...start, generation: "previous" }));
    await fs.writeFile(path.join(dir, "s.json"), JSON.stringify(latest));
    const events: ProviderStatusEvent[] = [];
    const watcher = await startProviderStatusWatcher(dir, (event) => events.push(event));
    try {
      await expect.poll(() => events.map((event) => event.event)).toEqual(["PreToolUse"]);
      await fs.writeFile(path.join(dir, "s.start.json"), JSON.stringify(start));
      await fs.writeFile(path.join(dir, "s.json"), JSON.stringify({ ...latest, event: "PostToolUse" }));
      await expect.poll(() => events.map((event) => event.event)).toEqual(["PreToolUse", "SessionStart", "PostToolUse"]);
      await fs.writeFile(path.join(dir, "s.json"), JSON.stringify({ ...latest, event: "Stop" }));
      await expect.poll(() => events.map((event) => event.event)).toEqual(["PreToolUse", "SessionStart", "PostToolUse", "Stop"]);
    } finally { watcher.close(); }
  });
});
