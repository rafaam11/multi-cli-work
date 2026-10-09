// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { controlPipeNameFor, ensureControlCli, resolveControlPipeName } from "./control-cli-installer";

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

    const { binDir } = await ensureControlCli(userData, "win32");

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

  it("adds POSIX shims so Git Bash (Claude Code's Bash tool on Windows) finds jk too", async () => {
    const userData = await tempRoot();

    const { binDir } = await ensureControlCli(userData, "win32");

    for (const name of ["jk", "jk-coding-cli"]) {
      const shim = await fs.readFile(path.join(binDir, name), "utf8");
      expect(shim.startsWith("#!/bin/sh\n")).toBe(true);
      // A CR would end up inside the shebang and the path — Git Bash needs pure LF.
      expect(shim).not.toContain("\r");
      expect(shim).toContain("jk-coding-cli.ps1");
      expect(shim).toContain('"$@"');
    }
  });

  it("replaces stale files on every start", async () => {
    const userData = await tempRoot();
    const binDir = path.join(userData, "bin");
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(binDir, "jk-coding-cli.ps1"), "old contents", "utf8");

    await ensureControlCli(userData, "win32");

    const script = await fs.readFile(path.join(binDir, "jk-coding-cli.ps1"), "utf8");
    expect(script).not.toBe("old contents");
    expect(script).toContain("JK_CODING_CLI_TOKEN");
  });

  it("writes executable Python 3 clients on Linux", async () => {
    const userData = await tempRoot();
    const { binDir } = await ensureControlCli(userData, "linux");
    for (const name of ["jk", "jk-coding-cli"]) {
      const file = path.join(binDir, name);
      expect(await fs.readFile(file, "utf8")).toContain("#!/usr/bin/env python3");
      if (process.platform !== "win32") expect((await fs.stat(file)).mode & 0o111).not.toBe(0);
    }
  });
});

describe("controlPipeNameFor", () => {
  it("gives each userData its own pipe so a second instance does not lose jk", () => {
    const installed = controlPipeNameFor("C:\\Users\\me\\AppData\\Roaming\\multi-cli-work", "win32");
    const dev = controlPipeNameFor("C:\\temp\\mcw-e2e\\user-data", "win32");

    expect(installed).toMatch(/^jk-coding-cli-[0-9a-f]{8}$/);
    expect(dev).not.toBe(installed);
    // Windows paths compare case-insensitively, so the same folder spelled differently is one pipe.
    expect(controlPipeNameFor("c:\\users\\me\\appdata\\roaming\\multi-cli-work", "win32")).toBe(installed);
  });
});

describe("resolveControlPipeName", () => {
  const userData = "C:\\temp\\mcw-dev\\user-data";

  it("honours an explicit JK_CODING_CLI_PIPE", () => {
    expect(resolveControlPipeName({ JK_CODING_CLI_PIPE: "custom-pipe" }, userData, "win32")).toBe("custom-pipe");
  });

  it("ignores the pipe of the app session it was launched from — a dev build started in an app terminal", () => {
    const inherited = { JK_CODING_CLI_PIPE: "jk-coding-cli-parent", JK_CODING_CLI_TOKEN: "parent-token" };
    expect(resolveControlPipeName(inherited, userData, "win32")).toBe(controlPipeNameFor(userData, "win32"));
  });

  it("falls back to the userData pipe", () => {
    expect(resolveControlPipeName({}, userData, "win32")).toBe(controlPipeNameFor(userData, "win32"));
  });
});
