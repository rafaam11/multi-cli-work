// @vitest-environment node
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createWorkbenchStore, parseWorkbench, parsePrompt, parseSavedView } from "./workbench-store";
import type { SavedViewPreset } from "../../shared/workbench-types";

const dirs: string[] = [];
it.each([["board", "records"], ["deliveries", "records"], ["activity", "records"], ["prompts", "files"], ["records", "records"]])("restores legacy tab %s as %s without rejecting the whole store", (oldTab, expected) => {
  const saved = { id: "v", name: "Layout", layoutId: "auto", sidebarCollapsed: false, rightSidebarCollapsed: false, rightSidebarTab: oldTab };
  expect(parseSavedView(saved).rightSidebarTab).toBe(expected);
  expect(parseWorkbench({ schemaVersion: 1, prompts: [], drafts: { s: "keep" }, pinnedPaneIds: ["s"], savedViews: [saved] })).toMatchObject({ drafts: { s: "keep" }, pinnedPaneIds: ["s"], savedViews: [{ rightSidebarTab: expected }] });
});
afterEach(async () => { await Promise.all(dirs.map(dir => rm(dir, { recursive: true, force: true }))); dirs.length = 0; });
async function location() { const dir = await mkdtemp(path.join(os.tmpdir(), "mcw-workbench-test-")); dirs.push(dir); return path.join(dir, "workbench-state.json"); }
it("persists profiles and named layouts while preserving unrelated workbench data", async () => {
  const file = await location(); const store = await createWorkbenchStore(file, [{ name: "Review", text: "Check changes" }]);
  await store.saveDraft("s", "draft"); await store.recordFork("child", "s");
  const profile = { id: "codex-review", name: "Review", agentId: "codex" as const, model: "gpt-5.5", effort: "high" };
  const view: SavedViewPreset = { id: "view", name: "Review layout", layoutId: "cols:1-2", sidebarCollapsed: true, rightSidebarCollapsed: false, rightSidebarTab: "records" };
  await Promise.all([store.saveLaunchProfile(profile), store.saveView(view)]);
  await store.setDefaultLaunchProfile("codex", profile.id);
  const reopened = await createWorkbenchStore(file, []);
  expect(await reopened.resolveLaunchProfile("codex")).toEqual(profile);
  expect(await reopened.resolveLaunchProfile("codex", null)).toBeNull();
  await expect(reopened.resolveLaunchProfile("claude", profile.id)).rejects.toThrow();
  await expect(reopened.setDefaultLaunchProfile("claude", profile.id)).rejects.toThrow();
  expect((await reopened.state()).state).toMatchObject({ prompts: [{ name: "Review" }], drafts: { s: "draft" }, forks: { child: "s" }, savedViews: [view] });
  await reopened.removeLaunchProfile(profile.id);
  expect(await reopened.resolveLaunchProfile("codex")).toBeNull();
  await reopened.removeView(view.id);
  expect((await reopened.state()).state.savedViews).toEqual([]);
});
it("rejects malformed layouts and clears incompatible defaults when a profile changes provider", async () => {
  const store = await createWorkbenchStore(await location(), []);
  const profile = { id: "p", name: "Profile", agentId: "codex" as const, model: null, effort: "high" };
  await store.saveLaunchProfile(profile); await store.setDefaultLaunchProfile("codex", "p");
  await store.saveLaunchProfile({ ...profile, agentId: "claude" });
  expect(await store.resolveLaunchProfile("codex")).toBeNull();
  for (const layoutId of ["cols:3", "cols:1-1-1-1-1-1-1", "arbitrary"]) {
    await expect(store.saveView({ id: "v", name: "Layout", layoutId, sidebarCollapsed: false, rightSidebarCollapsed: false, rightSidebarTab: "files" })).rejects.toThrow();
  }
});
it("migrates legacy templates once and keeps concurrent drafts", async () => {
  const file = await location();
  const store = await createWorkbenchStore(file, [{ name: "Review", text: "Review changes" }]);
  const prompt = (await store.state()).state.prompts[0];
  await Promise.all([store.saveDraft("one", "first"), store.saveDraft("two", "second")]);
  const reopened = await createWorkbenchStore(file, [{ name: "Other", text: "Do not import again" }]);
  expect((await reopened.state()).state).toMatchObject({ prompts: [prompt], drafts: { one: "first", two: "second" } });
  await reopened.saveDraft("one", "");
  expect((await reopened.state()).state.drafts).toEqual({ two: "second" });
});
it("preserves a corrupt primary and exposes the backup as read-only", async () => {
  const file = await location();
  const store = await createWorkbenchStore(file, []);
  await store.saveDraft("one", "saved");
  await writeFile(file, "broken JSON");
  expect(await store.state()).toMatchObject({ writable: false });
  await expect(store.saveDraft("two", "must not overwrite")).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe("broken JSON");
});
it("validates limits and duplicate IDs", () => {
  const prompt = { id: "a", name: "name", text: "request", tags: [], favorite: false, agentId: null };
  expect(() => parsePrompt({ ...prompt, text: "x".repeat(8001) })).toThrow();
  expect(() => parseWorkbench({ schemaVersion: 1, prompts: [prompt, prompt], drafts: {} })).toThrow();
  expect(() => parseWorkbench({ schemaVersion: 2, prompts: [], drafts: {} })).toThrow();
});
it("preserves legacy pins and fork lineage without changing drafts or templates", async () => {
  const file = await location();
  await writeFile(file, JSON.stringify({ schemaVersion: 1, prompts: [{ id: "p", name: "Review", text: "Check changes", tags: [], favorite: false, agentId: null }], drafts: {}, pinnedPaneIds: ["parent"] }));
  const store = await createWorkbenchStore(file, []);
  await store.saveDraft("parent", "Keep this draft");
  await store.recordFork("child", "parent");
  const reopened = await createWorkbenchStore(file, []);
  expect((await reopened.state()).state).toMatchObject({ pinnedPaneIds: ["parent"], forks: { child: "parent" }, drafts: { parent: "Keep this draft" }, prompts: [{ name: "Review" }] });
  await reopened.saveDraft("other", "new draft");
  expect((await reopened.state()).state.pinnedPaneIds).toEqual(["parent"]);
});
it("merges imported prompts without replacing existing entries or exporting drafts", async () => {
  const file = await location();
  const store = await createWorkbenchStore(file, [{ name: "Review", text: "Review changes" }]);
  const original = (await store.state()).state.prompts[0];
  const json = JSON.stringify({ format: "mcw-prompts", version: 1, prompts: [original, { ...original, name: "Test", text: "Run tests" }] });
  await store.importPrompts(json);
  await store.importPrompts(json);
  expect((await store.state()).state.prompts).toHaveLength(2);
  expect((await store.state()).state.prompts[0].id).toBe(original.id);
  await expect(store.importPrompts('{"format":"other"}')).rejects.toThrow();
});
