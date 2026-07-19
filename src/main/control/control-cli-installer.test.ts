// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureControlCli } from "./control-cli-installer";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-control-cli-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("ensureControlCli", () => {
  it("writes the CLI script and both command shims into userData/bin", async () => {
    const userData = await tempRoot();

    const { binDir } = await ensureControlCli(userData);

    expect(binDir).toBe(path.join(userData, "bin"));
    const script = await fs.readFile(path.join(binDir, "jk-coding-cli.ps1"), "utf8");
    const shim = await fs.readFile(path.join(binDir, "jk-coding-cli.cmd"), "utf8");
    const alias = await fs.readFile(path.join(binDir, "jk.cmd"), "utf8");

    // The shim resolves the script next to itself, so bin/ can live anywhere.
    expect(shim).toContain('"%~dp0jk-coding-cli.ps1" %*');
    expect(alias).toBe(shim);
    // The script refuses to run outside an app-spawned session, and speaks the fixed pipe protocol.
    expect(script).toContain("JK_CODING_CLI_TOKEN");
    expect(script).toContain("MULTI_CLI_WORK_SESSION_ID");
    expect(script).toContain('"jk-coding-cli"');
    for (const command of ["list", "send", "read", "wait", "spawn"]) {
      expect(script).toContain(`"${command}"`);
    }
  });

  it("replaces stale files on every start", async () => {
    const userData = await tempRoot();
    const binDir = path.join(userData, "bin");
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(binDir, "jk-coding-cli.ps1"), "old contents", "utf8");

    await ensureControlCli(userData);

    const script = await fs.readFile(path.join(binDir, "jk-coding-cli.ps1"), "utf8");
    expect(script).not.toBe("old contents");
    expect(script).toContain("JK_CODING_CLI_TOKEN");
  });
});
