// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendSessionLog,
  emptyAppState,
  readAppState,
  readSessionLog,
  updateAppState,
} from "./app-state";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-state-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("app state", () => {
  it("persists restorable session metadata with atomic updates", async () => {
    const root = await tempRoot();
    const statePath = path.join(root, "state.json");
    await updateAppState(
      (state) => ({
        ...state,
        selectedProjectId: "project-1",
        selectedSessionId: "session-1",
        sessions: {
          "session-1": {
            id: "session-1",
            projectId: "project-1",
            kind: "claude",
            cwd: "C:\\Work",
            providerConversationId: "claude-1",
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T01:00:00.000Z",
          },
        },
      }),
      { statePath },
    );

    const snapshot = await readAppState({ statePath });
    expect(snapshot.writable).toBe(true);
    expect(snapshot.state.sessions["session-1"]).toMatchObject({ kind: "claude", providerConversationId: "claude-1" });
  });

  it("falls back to a valid backup without making corrupt state writable", async () => {
    const root = await tempRoot();
    const statePath = path.join(root, "state.json");
    await fs.writeFile(statePath, "broken", "utf8");
    await fs.writeFile(`${statePath}.bak`, JSON.stringify(emptyAppState()), "utf8");

    const snapshot = await readAppState({ statePath });

    expect(snapshot.source).toBe("backup");
    expect(snapshot.writable).toBe(false);
  });

  it("prefers a valid backup when the primary state file is missing", async () => {
    const root = await tempRoot();
    const statePath = path.join(root, "state.json");
    const backup = emptyAppState("2026-07-11T00:00:00.000Z");
    await fs.writeFile(`${statePath}.bak`, JSON.stringify(backup), "utf8");

    const snapshot = await readAppState({ statePath });

    expect(snapshot).toMatchObject({ source: "backup", writable: false, state: backup });
    expect(snapshot.warning).toMatch(/missing/i);
  });

  it("keeps only the newest bounded terminal output", async () => {
    const root = await tempRoot();
    await appendSessionLog(root, "session-1", "123456", 10);
    await appendSessionLog(root, "session-1", "7890AB", 10);

    const replay = await readSessionLog(root, "session-1", 10);

    expect(replay).toBe("34567890AB");
    expect(Buffer.byteLength(replay)).toBe(10);
  });

  it("appends output without replacing a log that remains below its limit", async () => {
    const root = await tempRoot();
    await appendSessionLog(root, "session-1", "first", 100);
    const logPath = path.join(root, "session-1.log");
    const before = await fs.stat(logPath);

    await appendSessionLog(root, "session-1", "-second", 100);

    expect(await fs.readFile(logPath, "utf8")).toBe("first-second");
    expect((await fs.stat(logPath)).ino).toBe(before.ino);
  });

  it("uses bounded trim slack to amortize full log compaction", async () => {
    const root = await tempRoot();
    const logPath = path.join(root, "session-1.log");

    await appendSessionLog(root, "session-1", "123456789012", 10, 5);
    expect((await fs.stat(logPath)).size).toBe(12);
    expect(await readSessionLog(root, "session-1", 10)).toBe("3456789012");

    await appendSessionLog(root, "session-1", "ABCD", 10, 5);
    expect((await fs.stat(logPath)).size).toBe(10);
    expect(await readSessionLog(root, "session-1", 10)).toBe("789012ABCD");
  });
});
