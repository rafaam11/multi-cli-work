// @vitest-environment node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { verifyHerdrConptyBundle } from "./herdr-resource";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

async function bundle() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-conpty-")); roots.push(root);
  const files = { "conpty/arm64/OpenConsole.exe": "arm64 host", "conpty/conpty.dll": "dll", "conpty/x64/OpenConsole.exe": "x64 host" };
  for (const [file, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, "herdr/windows-mcw", file)), { recursive: true }); await fs.writeFile(path.join(root, "herdr/windows-mcw", file), content); }
  const manifest = JSON.stringify({ architecture: "x86_64", files: Object.fromEntries(Object.entries(files).map(([file, content]) => [file, sha(content)])) });
  await fs.writeFile(path.join(root, "herdr/windows-mcw/conpty/herdr-conpty.json"), manifest);
  await fs.writeFile(path.join(root, "assets.json"), JSON.stringify({ windowsMembers: [{ file: "conpty/herdr-conpty.json", sha256: sha(manifest) }] }));
  return root;
}

it("names the ConPTY file the v2.0.0 installer dropped instead of letting Herdr panic on the first session", async () => {
  const root = await bundle();
  await expect(verifyHerdrConptyBundle(root)).resolves.toBeUndefined();
  await fs.rm(path.join(root, "herdr/windows-mcw/conpty/arm64/OpenConsole.exe"));
  await expect(verifyHerdrConptyBundle(root)).rejects.toThrow(/conpty\/arm64\/OpenConsole\.exe 없음.*releases\/latest/);
});

it("rejects a changed ConPTY file and a manifest that differs from the pinned assets", async () => {
  const root = await bundle();
  await fs.writeFile(path.join(root, "herdr/windows-mcw/conpty/conpty.dll"), "tampered");
  await expect(verifyHerdrConptyBundle(root)).rejects.toThrow(/conpty\/conpty\.dll 변경됨/);
  await fs.writeFile(path.join(root, "assets.json"), JSON.stringify({ windowsMembers: [{ file: "conpty/herdr-conpty.json", sha256: sha("other") }] }));
  await expect(verifyHerdrConptyBundle(root)).rejects.toThrow(/herdr-conpty\.json 변경됨/);
});
