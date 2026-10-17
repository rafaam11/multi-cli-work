// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_PRESETS, parseSessionPreset, readSessionPresets, removeSessionPreset, saveSessionPreset } from "./preset-registry";

describe("preset registry", () => {
  let directory: string;
  let registryPath: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "presets-"));
    registryPath = path.join(directory, "session-presets.json");
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("offers the built-in example until the file exists, and keeps a deletion", async () => {
    expect((await readSessionPresets({ registryPath })).map((preset) => preset.id)).toEqual(["builder-reviewer"]);
    await removeSessionPreset("builder-reviewer", { registryPath });
    expect(await readSessionPresets({ registryPath })).toEqual([]);
  });

  it("adds a preset and replaces one with the same id in place", async () => {
    const trio = { id: "trio", name: "셋", members: [{ agentId: "claude", name: "A" }] };
    await saveSessionPreset(trio, { registryPath });
    await saveSessionPreset({ ...trio, name: "셋(수정)" }, { registryPath });
    const presets = await readSessionPresets({ registryPath });
    expect(presets.map((preset) => [preset.id, preset.name])).toEqual([
      ["builder-reviewer", BUILTIN_PRESETS[0].name],
      ["trio", "셋(수정)"],
    ]);
  });

  it("rejects bad presets: unknown fields, no members, a bad agent id, an empty name", () => {
    const base = { id: "x", name: "x", members: [{ agentId: "claude", name: "a" }] };
    expect(() => parseSessionPreset({ ...base, extra: 1 })).toThrow("unknown fields");
    expect(() => parseSessionPreset({ ...base, members: [] })).toThrow("members");
    expect(() => parseSessionPreset({ ...base, members: [{ agentId: "../x", name: "a" }] })).toThrow("agentId");
    expect(() => parseSessionPreset({ ...base, name: "  " })).toThrow("empty");
    expect(parseSessionPreset({ ...base, description: "", members: [{ agentId: "codex", name: " r ", prompt: "" }] })).toEqual({
      id: "x",
      name: "x",
      members: [{ agentId: "codex", name: "r" }],
    });
  });
});
