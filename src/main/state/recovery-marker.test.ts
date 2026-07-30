// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emptyAppState, readAppState, updateAppState } from "./app-state";
import { consumeRecoveryMarker, writeRecoveryMarkerSync } from "./recovery-marker";

const roots: string[] = [];

describe("recovery marker", () => {
  afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

  it("recovers only marker sessions as interrupted and consumes the marker", async () => {
    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-recovery-"));
    roots.push(root);
    const statePath = path.join(root, "state.json");
    const markerPath = path.join(root, "shutdown-recovery.json");
    const base = {
      id: "session-1", projectId: "project", tool: null, title: null, name: null,
      kind: "claude", cwd: root, providerConversationId: "conversation", interruptedByShutdown: false,
      createdAt: "2026-07-30T00:00:00.000Z", updatedAt: "2026-07-30T00:00:00.000Z",
    } as const;
    await updateAppState(() => ({ ...emptyAppState(), sessions: {
      "session-1": base,
      "session-2": { ...base, id: "session-2" },
    } }), { statePath });
    writeRecoveryMarkerSync(markerPath, ["session-1", "missing"], "2026-07-30T01:00:00.000Z");

    await consumeRecoveryMarker(markerPath, statePath);

    const state = (await readAppState({ statePath })).state;
    expect(state.sessions["session-1"].interruptedByShutdown).toBe(true);
    expect(state.sessions["session-2"].interruptedByShutdown).toBe(false);
    await expect(fs.stat(markerPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
