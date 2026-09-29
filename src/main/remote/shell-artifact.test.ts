// @vitest-environment node

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseShellRelease, readShellArtifact } from "./shell-artifact";

const SHA = "a".repeat(64);

describe("parseShellRelease", () => {
  it("accepts a well-formed manifest and rejects anything else", () => {
    expect(parseShellRelease({ versionCode: 2, versionName: "0.2.0", sha256: SHA })).toEqual({
      versionCode: 2,
      versionName: "0.2.0",
      sha256: SHA,
    });
    for (const bad of [null, {}, { versionCode: 0, versionName: "x", sha256: SHA }, { versionCode: 1.5, versionName: "x", sha256: SHA }, { versionCode: 1, versionName: "", sha256: SHA }, { versionCode: 1, versionName: "x", sha256: "nothex" }]) {
      expect(parseShellRelease(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("readShellArtifact", () => {
  it("reads shell.json next to shell.apk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mcw-shell-"));
    await writeFile(path.join(dir, "shell.apk"), "apk");
    await writeFile(path.join(dir, "shell.json"), JSON.stringify({ versionCode: 1, versionName: "0.1.0", sha256: SHA }));
    expect(await readShellArtifact(dir)).toEqual({
      release: { versionCode: 1, versionName: "0.1.0", sha256: SHA },
      apkPath: path.join(dir, "shell.apk"),
    });
  });

  it("is null when either file is missing or the manifest is bad", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mcw-shell-"));
    expect(await readShellArtifact(dir)).toBeNull();
    await writeFile(path.join(dir, "shell.json"), JSON.stringify({ versionCode: 1, versionName: "0.1.0", sha256: SHA }));
    expect(await readShellArtifact(dir)).toBeNull();
    await writeFile(path.join(dir, "shell.apk"), "apk");
    await writeFile(path.join(dir, "shell.json"), "{bad");
    expect(await readShellArtifact(dir)).toBeNull();
  });
});
