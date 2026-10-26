import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MobileAttentionStore } from "./mobile-attention-store";

const dirs: string[] = [];
async function setup() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-attention-"));
  dirs.push(dir);
  const file = path.join(dir, "mobile-attention.json");
  return { file, store: new MobileAttentionStore(file) };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
describe("MobileAttentionStore", () => {
  it("persists waits, deduplicates identical states, and never sees a newer wait through a stale ack", async () => {
    const { store, file } = await setup();
    expect(await store.observe("s", "awaiting-input")).toEqual({ generation: 1, seenThrough: 0 });
    expect(await store.observe("s", "awaiting-input")).toEqual({ generation: 1, seenThrough: 0 });
    await store.observe("s", "working");
    expect(await store.observe("s", "awaiting-input")).toEqual({ generation: 2, seenThrough: 0 });
    expect(await store.seen("s", 1)).toEqual({ generation: 2, seenThrough: 1 });
    expect(await store.seen("s", 999)).toEqual({ generation: 2, seenThrough: 1 });
    const restarted = new MobileAttentionStore(file);
    expect(await restarted.current("s")).toEqual({ generation: 2, seenThrough: 1 });
    expect(await restarted.observe("s", "awaiting-approval", true)).toEqual({ generation: 3, seenThrough: 3 });
  });
  it("serializes overlapping status and seen writes without losing a generation", async () => {
    const { store } = await setup();
    const result = await Promise.all([
      store.observe("s", "awaiting-input"), store.seen("s", 1),
      store.observe("s", "working"), store.observe("s", "awaiting-approval"), store.seen("s", 1),
    ]);
    expect(result.at(-1)).toEqual({ generation: 2, seenThrough: 1 });
    await store.remove("s");
    expect(await store.current("s")).toEqual({ generation: 0, seenThrough: 0 });
  });
  it("refuses to overwrite damaged persistence or its backup", async () => {
    const { store, file } = await setup();
    await store.observe("s", "awaiting-input");
    await store.seen("s", 1);
    await fs.writeFile(file, "broken");
    await expect(store.observe("s", "working")).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe("broken");
  });
});
