// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import { UsageHistoryStore } from "./usage-history";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
it("deduplicates source timestamps and retains separate reset periods", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-usage-history-")); roots.push(root);
  const now = Date.parse("2026-10-29T12:00:00Z");
  const store = new UsageHistoryStore(path.join(root, "history.json"), () => now);
  const snapshot = { claude: null, codex: { updatedAt: new Date(now).toISOString(), plan: null, windows: [{ kind: "5h" as const, usedPercent: 70, resetsAt: "2026-10-29T14:00:00Z" }] } };
  await store.record(snapshot); await store.record(snapshot);
  expect((await store.list()).samples).toHaveLength(1);
  await store.record({ ...snapshot, codex: { ...snapshot.codex, updatedAt: new Date(now - 8 * 86400_000).toISOString() } });
  expect((await store.list()).samples).toHaveLength(1);
  await expect(store.record({ ...snapshot, codex: { ...snapshot.codex, windows: [{ ...snapshot.codex.windows[0], usedPercent: Number.NaN }] } })).rejects.toThrow();
  expect((await store.list()).samples).toHaveLength(1);
});
