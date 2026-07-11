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
  it("returns only a newly created session for the requested working directory", async () => {
    const sessionsDirectory = await tempRoot();
    await writeSession(sessionsDirectory, "existing", "codex-existing", "C:\\Work");
    await writeSession(sessionsDirectory, "other", "codex-other", "C:\\Other");
    const tracker = new CodexSessionTracker({ sessionsDirectory, pollIntervalMs: 1, maxAttempts: 5 });
    const known = await tracker.snapshot("c:\\work\\");

    await writeSession(sessionsDirectory, "created", "codex-created", "C:\\Work");

    await expect(tracker.waitForNew("C:\\WORK", known)).resolves.toBe("codex-created");
  });

  it("ignores malformed metadata and returns null after the retry window", async () => {
    const sessionsDirectory = await tempRoot();
    await fs.writeFile(path.join(sessionsDirectory, "broken.jsonl"), "{broken\n", "utf8");
    const tracker = new CodexSessionTracker({ sessionsDirectory, pollIntervalMs: 1, maxAttempts: 2 });

    await expect(tracker.waitForNew("C:\\Work", new Set())).resolves.toBeNull();
  });
});
