// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isWorkspaceExecutable,
  listWorkspaceDirectory,
  readWorkspaceFile,
  runWorkspaceExecutable,
  writeWorkspaceFile,
} from "./workspace-files";

let tempRoot: string;
let projectRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-workspace-files-"));
  projectRoot = path.join(tempRoot, "project");
  await fs.mkdir(path.join(projectRoot, "src"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, ".git"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "readme.md"), "# hello\n", "utf8");
  await fs.writeFile(path.join(projectRoot, "src", "index.ts"), "export {};\n", "utf8");
  await fs.writeFile(path.join(projectRoot, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  // A sibling outside the project root, target for the escape attempts below.
  await fs.writeFile(path.join(tempRoot, "secret.txt"), "outside\n", "utf8");
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("listWorkspaceDirectory", () => {
  it("lists the root, directories first, and excludes .git", async () => {
    const entries = await listWorkspaceDirectory(projectRoot, "");
    expect(entries.map((entry) => entry.name)).toEqual(["src", "readme.md"]);
    expect(entries.find((entry) => entry.name === ".git")).toBeUndefined();
  });

  it("lists a nested directory with a relativePath built from the parent", async () => {
    const entries = await listWorkspaceDirectory(projectRoot, "src");
    expect(entries).toEqual([
      { name: "index.ts", relativePath: "src/index.ts", kind: "file", extension: "ts", executable: false },
    ]);
  });

  it("rejects a relative path that escapes the root via ..", async () => {
    await expect(listWorkspaceDirectory(projectRoot, "../")).rejects.toThrow(/escapes the project root/);
  });
});

describe("readWorkspaceFile", () => {
  it("reads a text file as utf8", async () => {
    const result = await readWorkspaceFile(projectRoot, "readme.md");
    expect(result).toEqual({ relativePath: "readme.md", encoding: "utf8", content: "# hello\n", truncated: false, sizeBytes: 8 });
  });

  it("rejects an absolute path", async () => {
    await expect(readWorkspaceFile(projectRoot, path.join(tempRoot, "secret.txt"))).rejects.toThrow(/Invalid path/);
  });

  it("rejects a relative path that escapes the root via ..", async () => {
    await expect(readWorkspaceFile(projectRoot, "../secret.txt")).rejects.toThrow(/escapes the project root/);
  });

  it("rejects a path that only textually looks contained (prefix trick)", async () => {
    // "project-evil" is not inside "project" even though the string starts with it.
    const decoyRoot = `${projectRoot}-evil`;
    await fs.mkdir(decoyRoot, { recursive: true });
    await fs.writeFile(path.join(decoyRoot, "leak.txt"), "leak\n", "utf8");
    await expect(
      readWorkspaceFile(projectRoot, path.relative(projectRoot, path.join(decoyRoot, "leak.txt"))),
    ).rejects.toThrow(/escapes the project root/);
  });

  it("rejects reading a directory", async () => {
    await expect(readWorkspaceFile(projectRoot, "src")).rejects.toThrow(/Not a file/);
  });

  it("reports executable files using the target platform rules", async () => {
    await fs.writeFile(path.join(projectRoot, "run.sh"), "#!/bin/sh\n");
    await fs.chmod(path.join(projectRoot, "run.sh"), 0o755);

    const entries = await listWorkspaceDirectory(projectRoot, "", "linux");

    expect(isWorkspaceExecutable("run.sh", 0o100755, true, "linux")).toBe(true);
    expect(isWorkspaceExecutable("run.sh", 0o100644, true, "linux")).toBe(false);
    expect(isWorkspaceExecutable("tool.exe", 0, true, "win32")).toBe(true);
    if (process.platform !== "win32") expect(entries.find((entry) => entry.name === "run.sh")?.executable).toBe(true);
    expect(entries.find((entry) => entry.name === "readme.md")?.executable).toBe(false);
  });

  it("returns non-image binary files as base64 instead of lossy text", async () => {
    await fs.writeFile(path.join(projectRoot, "data.bin"), Buffer.from([0, 255, 1]));
    await expect(readWorkspaceFile(projectRoot, "data.bin")).resolves.toMatchObject({ encoding: "base64", content: "AP8B" });
  });

  it("reads only the preview cap and marks a large text file as truncated", async () => {
    await fs.writeFile(path.join(projectRoot, "large.txt"), "a".repeat(2 * 1024 * 1024 + 1), "utf8");
    await expect(readWorkspaceFile(projectRoot, "large.txt")).resolves.toMatchObject({ encoding: "utf8", truncated: true });
  });
});

describe("runWorkspaceExecutable", () => {
  it("runs a real exe in the root and propagates shell errors", async () => {
    await fs.writeFile(path.join(projectRoot, "tool.exe"), "not really executable");
    await expect(
      runWorkspaceExecutable(projectRoot, "tool.exe", async () => "Windows blocked this file", "win32"),
    ).rejects.toThrow("Windows blocked this file");
  });

  it("runs only regular files with an execute bit on Linux", async () => {
    if (process.platform === "win32") return;
    const tool = path.join(projectRoot, "tool");
    await fs.writeFile(tool, "#!/bin/sh\n");
    await fs.chmod(tool, 0o755);
    const run = vi.fn(async () => undefined);

    await runWorkspaceExecutable(projectRoot, "tool", run, "linux");
    expect(run).toHaveBeenCalledWith(tool);

    await fs.chmod(tool, 0o644);
    await expect(runWorkspaceExecutable(projectRoot, "tool", run, "linux")).rejects.toThrow(/executable permission/);
  });

  it("refuses non-executables and root escapes", async () => {
    await expect(runWorkspaceExecutable(projectRoot, "readme.md", async () => "", "win32")).rejects.toThrow(/Only .exe/);
    await expect(runWorkspaceExecutable(projectRoot, "../secret.exe", async () => "", "win32")).rejects.toThrow(/escapes/);
  });
});

describe("writeWorkspaceFile", () => {
  it("writes content to disk inside the root", async () => {
    await writeWorkspaceFile(projectRoot, "src/index.ts", "export const x = 1;\n");
    const written = await fs.readFile(path.join(projectRoot, "src", "index.ts"), "utf8");
    expect(written).toBe("export const x = 1;\n");
  });

  it("rejects writing outside the root", async () => {
    await expect(writeWorkspaceFile(projectRoot, "../secret.txt", "pwned")).rejects.toThrow(/escapes the project root/);
    expect(await fs.readFile(path.join(tempRoot, "secret.txt"), "utf8")).toBe("outside\n");
  });

  it("rejects content larger than the write cap", async () => {
    const huge = "a".repeat(6 * 1024 * 1024);
    await expect(writeWorkspaceFile(projectRoot, "src/index.ts", huge)).rejects.toThrow(/too large/);
  });
});
