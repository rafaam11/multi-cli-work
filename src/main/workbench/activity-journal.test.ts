// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import { ActivityJournal, parseActivity } from "./activity-journal";
const roots: string[] = [];
const journals: ActivityJournal[] = [];
afterEach(async () => { await Promise.all(journals.splice(0).map(journal => journal.stop())); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
it("keeps parallel events, rejects stale generations, and restores sanitized history", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-activity-")); roots.push(root);
  const spool = path.join(root, "spool"), directory = path.join(root, "journal");
  const journal = new ActivityJournal(spool, directory, event => event.generation === "current"); journals.push(journal);
  await journal.start();
  const base = { sessionId: "session", generation: "current", provider: "claude", event: "PreToolUse", at: new Date().toISOString(), toolName: "Read", tool_input: { secret: "never store" } };
  await Promise.all(["one", "two", "old"].map(id => fs.writeFile(path.join(spool, `${id}.json`), JSON.stringify({ ...base, id, generation: id === "old" ? "stale" : "current" }))));
  await Promise.all([journal.drain(), journal.drain()]);
  expect(journal.list()).toHaveLength(2); expect(JSON.stringify(journal.list())).not.toContain("never store");
  await fs.writeFile(path.join(spool, "duplicate.json"), JSON.stringify({ ...base, id: "one" }));
  await journal.drain(); expect(journal.list()).toHaveLength(2);
  await journal.stop();
  const restored = new ActivityJournal(spool, directory, () => false); journals.push(restored); await restored.start();
  expect(restored.list()).toHaveLength(2);
});
it("rejects unknown events and terminal control sequences", () => {
  const base = { id: "id", sessionId: "session", generation: "g", provider: "codex", event: "Stop", at: new Date().toISOString() };
  expect(() => parseActivity({ ...base, event: "arbitrary" })).toThrow();
  expect(() => parseActivity({ ...base, toolName: "\u001b[31m" })).toThrow();
});
it("orders parallel hook files by event time instead of random file names", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-activity-order-")); roots.push(root);
  const spool = path.join(root, "spool"), directory = path.join(root, "journal");
  const journal = new ActivityJournal(spool, directory, () => true); journals.push(journal); await journal.start();
  const base = { sessionId: "s", generation: "g", provider: "codex", at: new Date().toISOString() };
  await fs.writeFile(path.join(spool, "a.json"), JSON.stringify({ ...base, id: "post", event: "PostToolUse" }));
  await fs.writeFile(path.join(spool, "z.json"), JSON.stringify({ ...base, id: "pre", event: "PreToolUse" }));
  await journal.drain();
  expect(journal.list().map(event => event.event)).toEqual(["PreToolUse", "PostToolUse"]);
});
