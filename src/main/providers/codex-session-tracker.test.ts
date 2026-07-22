// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexSessionTracker } from "./codex-session-tracker";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-codex-session-"));
  roots.push(root);
  return root;
}

async function writeSession(root: string, name: string, id: string, cwd: string): Promise<void> {
  const filePath = path.join(root, "2026", "07", "11", `${name}.jsonl`);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `${JSON.stringify({
      type: "session_meta",
      payload: { id, session_id: id, cwd, timestamp: "2026-07-11T12:00:00.000Z" },
    })}\n`,
    "utf8",
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("CodexSessionTracker", () => {
  it("waits up to two minutes for a delayed transcript by default", () => {
    const tracker = new CodexSessionTracker({ sessionsDirectory: "C:\\sessions" });

    expect((tracker as unknown as { maxAttempts: number }).maxAttempts).toBe(300);
  });

  it("returns only a newly created session for the requested working directory", async () => {
    const sessionsDirectory = await tempRoot();
    await writeSession(sessionsDirectory, "existing", "codex-existing", "C:\\Work");
    await writeSession(sessionsDirectory, "other", "codex-other", "C:\\Other");
    const tracker = new CodexSessionTracker({ sessionsDirectory, pollIntervalMs: 1, maxAttempts: 5, platform: "win32" });
    const known = await tracker.snapshot("c:\\work\\");

    await writeSession(sessionsDirectory, "created", "codex-created", "C:\\Work");

    await expect(tracker.waitForNew("C:\\WORK", known)).resolves.toBe("codex-created");
  });

  it("keeps Linux working-directory case significant", async () => {
    const sessionsDirectory = await tempRoot();
    await writeSession(sessionsDirectory, "upper", "codex-upper", "/home/me/Project");
    const tracker = new CodexSessionTracker({ sessionsDirectory, pollIntervalMs: 1, maxAttempts: 1, platform: "linux" });
    expect(await tracker.snapshot("/home/me/project")).toEqual(new Set());
    expect(await tracker.snapshot("/home/me/Project")).toEqual(new Set(["codex-upper"]));
  });

  it("ignores malformed metadata and returns null after the retry window", async () => {
    const sessionsDirectory = await tempRoot();
    await fs.writeFile(path.join(sessionsDirectory, "broken.jsonl"), "{broken\n", "utf8");
    const tracker = new CodexSessionTracker({ sessionsDirectory, pollIntervalMs: 1, maxAttempts: 2 });

    await expect(tracker.waitForNew("C:\\Work", new Set())).resolves.toBeNull();
  });

  it("stops polling when app shutdown aborts correlation", async () => {
    const sessionsDirectory = await tempRoot();
    const tracker = new CodexSessionTracker({ sessionsDirectory, pollIntervalMs: 10_000, maxAttempts: 20 });
    const controller = new AbortController();

    const pending = tracker.waitForNew("C:\\Work", new Set(), controller.signal);
    controller.abort();

    await expect(pending).resolves.toBeNull();
  });

  it("atomically reserves different transcripts for concurrent trackers", async () => {
    const sessionsDirectory = await tempRoot();
    await writeSession(sessionsDirectory, "created-first", "codex-created-first", "C:\\Work");
    await writeSession(sessionsDirectory, "created-second", "codex-created-second", "C:\\Work");
    const firstTracker = new CodexSessionTracker({ sessionsDirectory, pollIntervalMs: 1, maxAttempts: 2, platform: "win32" });
    const secondTracker = new CodexSessionTracker({ sessionsDirectory, pollIntervalMs: 1, maxAttempts: 2, platform: "win32" });

    const correlated = await Promise.all([
      firstTracker.waitForNew("C:\\Work", new Set()),
      secondTracker.waitForNew("C:\\Work", new Set()),
    ]);

    expect(new Set(correlated)).toEqual(new Set(["codex-created-first", "codex-created-second"]));
  });
});
