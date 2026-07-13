// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendSessionLog,
  emptyAppState,
  parseAppState,
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

describe("session agent ids", () => {
  function stateWithKind(kind: unknown): unknown {
    return {
      schemaVersion: 1,
      updatedAt: "2026-07-11T00:00:00.000Z",
      selectedProjectId: null,
      selectedSessionId: null,
      sessions: {
        "session-1": {
          id: "session-1",
          projectId: "project-1",
          tool: null,
          title: null,
          name: null,
          kind,
          cwd: "C:\\Work",
          providerConversationId: null,
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
      },
    };
  }

  /**
   * The agent registry is a file the user edits. If removing an agent from it could invalidate the
   * state file, one edit to `agents.json` would cost them every session they have — so the state
   * file only checks the shape of an id, never whether an agent by that name still exists.
   */
  it("keeps sessions whose agent is no longer installed", () => {
    const parsed = parseAppState(stateWithKind("gemini"));

    expect(parsed.sessions["session-1"].kind).toBe("gemini");
  });

  it("still rejects an id that could never name an agent", () => {
    expect(() => parseAppState(stateWithKind("Claude Code"))).toThrow(/kind is invalid/i);
    expect(() => parseAppState(stateWithKind(42))).toThrow(/kind is invalid/i);
  });

  it("round-trips optional worktree and split keys, and omits both while unused", () => {
    const plain = parseAppState(stateWithKind("powershell"));
    expect(Object.keys(plain)).not.toContain("splitSessionId");
    expect(Object.keys(plain.sessions["session-1"])).not.toContain("worktreeId");

    const enriched = stateWithKind("powershell") as {
      splitSessionId?: string;
      sessions: Record<string, Record<string, unknown>>;
    };
    enriched.splitSessionId = "session-1";
    enriched.sessions["session-1"].worktreeId = "worktree-1";
    const parsed = parseAppState(enriched);
    expect(parsed.splitSessionId).toBe("session-1");
    expect(parsed.sessions["session-1"].worktreeId).toBe("worktree-1");
  });
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
            tool: null,
            title: "레지스트리 분리",
            name: null,
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
    expect(snapshot.state.sessions["session-1"]).toMatchObject({
      kind: "claude",
      providerConversationId: "claude-1",
      title: "레지스트리 분리",
      name: null,
    });
  });

  it("persists a maintenance session that belongs to no folder", async () => {
    const root = await tempRoot();
    const statePath = path.join(root, "state.json");
    await updateAppState(
      (state) => ({
        ...state,
        sessions: {
          "session-tool": {
            id: "session-tool",
            projectId: null,
            tool: "claude-update",
            title: null,
            name: null,
            kind: "powershell",
            cwd: "C:\\Users\\me",
            providerConversationId: null,
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
        },
      }),
      { statePath },
    );

    const snapshot = await readAppState({ statePath });
    expect(snapshot.state.sessions["session-tool"]).toMatchObject({ projectId: null, tool: "claude-update" });
  });

  it("reads state files written before titles, names, and maintenance sessions existed", async () => {
    const root = await tempRoot();
    const statePath = path.join(root, "state.json");
    await fs.writeFile(
      statePath,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: "2026-07-11T00:00:00.000Z",
        selectedProjectId: "project-1",
        selectedSessionId: "session-1",
        sessions: {
          "session-1": {
            id: "session-1",
            projectId: "project-1",
            kind: "powershell",
            cwd: "C:\\Work",
            providerConversationId: null,
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
        },
      }),
      "utf8",
    );

    const snapshot = await readAppState({ statePath });
    expect(snapshot.writable).toBe(true);
    expect(snapshot.state.sessions["session-1"]).toMatchObject({ tool: null, title: null, name: null });
  });

  it("rejects an unknown tool command", async () => {
    const root = await tempRoot();
    const statePath = path.join(root, "state.json");
    await fs.writeFile(
      statePath,
      JSON.stringify({
        schemaVersion: 1,
        updatedAt: "2026-07-11T00:00:00.000Z",
        selectedProjectId: null,
        selectedSessionId: null,
        sessions: {
          "session-1": {
            id: "session-1",
            projectId: null,
            tool: "rm-rf",
            kind: "powershell",
            cwd: "C:\\Work",
            providerConversationId: null,
            createdAt: "2026-07-11T00:00:00.000Z",
            updatedAt: "2026-07-11T00:00:00.000Z",
          },
        },
      }),
      "utf8",
    );

    await expect(readAppState({ statePath })).rejects.toThrow(/unreadable/);
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

  it("trims multi-byte log content on a UTF-8 character boundary instead of splitting it", async () => {
    const root = await tempRoot();

    await appendSessionLog(root, "session-1", "Hi가나다", 8);
    const replay = await readSessionLog(root, "session-1", 8);

    expect(Buffer.byteLength(replay)).toBeLessThanOrEqual(8);
    expect(replay).not.toContain("�");
    expect(replay).toBe("나다");
  });
});
