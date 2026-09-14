// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEditEntry } from "../providers/agent-edits";
import {
  changedPathsForRoot,
  createWorkspaceEntry,
  duplicateWorkspaceEntry,
  isWorkspaceExecutable,
  listWorkspaceDirectory,
  openWorkspaceEntry,
  readWorkspaceFile,
  renameWorkspaceEntry,
  resolveWorkspaceEntryPath,
  trashWorkspaceEntry,
  workspaceEntryName,
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
      {
        name: "index.ts",
        relativePath: "src/index.ts",
        kind: "file",
        extension: "ts",
        executable: false,
        mtimeMs: expect.any(Number),
      },
    ]);
  });

  it("reports mtimeMs from fs.stat for files and 0 for directories", async () => {
    const entries = await listWorkspaceDirectory(projectRoot, "");
    const dir = entries.find((entry) => entry.name === "src");
    const file = entries.find((entry) => entry.name === "readme.md");
    expect(dir?.mtimeMs).toBe(0);
    expect(file?.mtimeMs).toBe((await fs.stat(path.join(projectRoot, "readme.md"))).mtimeMs);
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

describe("openWorkspaceEntry", () => {
  it("runs a real exe once confirmed and propagates shell errors", async () => {
    await fs.writeFile(path.join(projectRoot, "tool.exe"), "not really executable");
    await expect(
      openWorkspaceEntry(
        projectRoot,
        "tool.exe",
        { confirmedRun: true },
        async () => "Windows blocked this file",
        "win32",
      ),
    ).rejects.toThrow("Windows blocked this file");
  });

  it("refuses a run-confirm extension without confirmation, without touching openPath", async () => {
    await fs.writeFile(path.join(projectRoot, "tool.exe"), "not really executable");
    const openPath = vi.fn(async () => undefined);
    await expect(
      openWorkspaceEntry(projectRoot, "tool.exe", { confirmedRun: false }, openPath, "win32"),
    ).rejects.toThrow(/confirmation/);
    expect(openPath).not.toHaveBeenCalled();
  });

  it("opens a document extension straight through, no confirmation needed", async () => {
    const openPath = vi.fn(async () => undefined);
    await openWorkspaceEntry(projectRoot, "readme.md", { confirmedRun: false }, openPath, "win32");
    expect(openPath).toHaveBeenCalledWith(path.join(projectRoot, "readme.md"));
  });

  it("gates a Linux execute-bit file on confirmation, and opens a non-executable one straight through", async () => {
    if (process.platform === "win32") return;
    const tool = path.join(projectRoot, "tool");
    await fs.writeFile(tool, "#!/bin/sh\n");
    await fs.chmod(tool, 0o755);
    const refused = vi.fn(async () => undefined);
    await expect(
      openWorkspaceEntry(projectRoot, "tool", { confirmedRun: false }, refused, "linux"),
    ).rejects.toThrow(/confirmation/);
    expect(refused).not.toHaveBeenCalled();

    const run = vi.fn(async () => undefined);
    await openWorkspaceEntry(projectRoot, "tool", { confirmedRun: true }, run, "linux");
    expect(run).toHaveBeenCalledWith(tool);

    await fs.chmod(tool, 0o644);
    const runUnconfirmed = vi.fn(async () => undefined);
    await openWorkspaceEntry(projectRoot, "tool", { confirmedRun: false }, runUnconfirmed, "linux");
    expect(runUnconfirmed).toHaveBeenCalledWith(tool);
  });

  it("rejects a root escape regardless of confirmation", async () => {
    await expect(
      openWorkspaceEntry(projectRoot, "../secret.exe", { confirmedRun: true }, async () => "", "win32"),
    ).rejects.toThrow(/escapes/);
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

describe("workspaceEntryName", () => {
  it("keeps an ordinary name, trimmed", () => {
    expect(workspaceEntryName("  notes.md  ")).toBe("notes.md");
  });

  it("refuses names that would escape the folder or that Windows cannot hold", () => {
    expect(() => workspaceEntryName("")).toThrow(/must not be empty/);
    expect(() => workspaceEntryName("../escape")).toThrow(/must not contain/);
    expect(() => workspaceEntryName("sub/child.ts")).toThrow(/must not contain/);
    expect(() => workspaceEntryName("a:b")).toThrow(/must not contain/);
    expect(() => workspaceEntryName("..")).toThrow(/is invalid/);
    expect(() => workspaceEntryName("trailing.")).toThrow(/must not end with a dot/);
    expect(() => workspaceEntryName("aux.ts")).toThrow(/Windows reserves/);
    expect(() => workspaceEntryName(`a${String.fromCharCode(0)}b`)).toThrow(/control characters/);
    expect(() => workspaceEntryName("a".repeat(256))).toThrow(/too long/);
  });
});

describe("resolveWorkspaceEntryPath", () => {
  it("resolves a folder as well as a file", async () => {
    expect(await resolveWorkspaceEntryPath(projectRoot, "src")).toBe(path.join(projectRoot, "src"));
    expect(await resolveWorkspaceEntryPath(projectRoot, "readme.md")).toBe(path.join(projectRoot, "readme.md"));
  });

  it("rejects a path outside the root and one that is not there", async () => {
    await expect(resolveWorkspaceEntryPath(projectRoot, "../secret.txt")).rejects.toThrow(/escapes the project root/);
    await expect(resolveWorkspaceEntryPath(projectRoot, "nope.txt")).rejects.toThrow();
  });
});

describe("createWorkspaceEntry", () => {
  it("creates an empty file and a folder under the given parent", async () => {
    expect(await createWorkspaceEntry(projectRoot, "src", "new.ts", "file")).toBe("src/new.ts");
    expect(await createWorkspaceEntry(projectRoot, "", "docs", "directory")).toBe("docs");

    expect(await fs.readFile(path.join(projectRoot, "src", "new.ts"), "utf8")).toBe("");
    expect((await fs.stat(path.join(projectRoot, "docs"))).isDirectory()).toBe(true);
  });

  it("refuses to overwrite an existing entry", async () => {
    await expect(createWorkspaceEntry(projectRoot, "src", "index.ts", "file")).rejects.toThrow(/already exists/);
    expect(await fs.readFile(path.join(projectRoot, "src", "index.ts"), "utf8")).toBe("export {};\n");
  });

  it("refuses a name that walks out of the parent", async () => {
    await expect(createWorkspaceEntry(projectRoot, "src", "../../pwned.txt", "file")).rejects.toThrow(/must not contain/);
    await expect(createWorkspaceEntry(projectRoot, "..", "pwned.txt", "file")).rejects.toThrow(/escapes the project root/);
  });
});

describe("renameWorkspaceEntry", () => {
  it("renames in place and reports the new relative path", async () => {
    expect(await renameWorkspaceEntry(projectRoot, "src/index.ts", "main.ts")).toBe("src/main.ts");
    expect(await fs.readFile(path.join(projectRoot, "src", "main.ts"), "utf8")).toBe("export {};\n");
  });

  it("refuses to replace a name that is taken", async () => {
    await fs.writeFile(path.join(projectRoot, "src", "taken.ts"), "keep\n", "utf8");
    await expect(renameWorkspaceEntry(projectRoot, "src/index.ts", "taken.ts")).rejects.toThrow(/already exists/);
    expect(await fs.readFile(path.join(projectRoot, "src", "taken.ts"), "utf8")).toBe("keep\n");
  });

  it("lets a rename that only changes case through on a case-insensitive file system", async () => {
    expect(await renameWorkspaceEntry(projectRoot, "readme.md", "README.md", "win32")).toBe("README.md");
  });

  it("refuses the root and a path outside it", async () => {
    await expect(renameWorkspaceEntry(projectRoot, "", "elsewhere")).rejects.toThrow(/root folder cannot be renamed/);
    await expect(renameWorkspaceEntry(projectRoot, "../secret.txt", "taken.txt")).rejects.toThrow(/escapes the project root/);
  });
});

describe("duplicateWorkspaceEntry", () => {
  it("copies a file next to itself, keeping the extension", async () => {
    expect(await duplicateWorkspaceEntry(projectRoot, "src/index.ts")).toBe("src/index copy.ts");
    expect(await fs.readFile(path.join(projectRoot, "src", "index copy.ts"), "utf8")).toBe("export {};\n");
  });

  it("numbers the next copy instead of overwriting the first", async () => {
    await duplicateWorkspaceEntry(projectRoot, "src/index.ts");
    expect(await duplicateWorkspaceEntry(projectRoot, "src/index.ts")).toBe("src/index copy 2.ts");
  });

  it("copies a folder with everything under it", async () => {
    expect(await duplicateWorkspaceEntry(projectRoot, "src")).toBe("src copy");
    expect(await fs.readFile(path.join(projectRoot, "src copy", "index.ts"), "utf8")).toBe("export {};\n");
  });

  it("refuses the root", async () => {
    await expect(duplicateWorkspaceEntry(projectRoot, "")).rejects.toThrow(/root folder cannot be duplicated/);
  });
});

describe("trashWorkspaceEntry", () => {
  it("hands the absolute path to the trash function", async () => {
    const trashItem = vi.fn(async () => undefined);
    await trashWorkspaceEntry(projectRoot, "src/index.ts", trashItem);
    expect(trashItem).toHaveBeenCalledWith(path.join(projectRoot, "src", "index.ts"));
  });

  it("never reaches outside the root, or the root itself", async () => {
    const trashItem = vi.fn(async () => undefined);
    await expect(trashWorkspaceEntry(projectRoot, "../secret.txt", trashItem)).rejects.toThrow(/escapes the project root/);
    await expect(trashWorkspaceEntry(projectRoot, "", trashItem)).rejects.toThrow(/root folder cannot be deleted/);
    expect(trashItem).not.toHaveBeenCalled();
  });
});

describe("changedPathsForRoot", () => {
  function entry(at = 1): AgentEditEntry {
    return { at, kind: "file" };
  }

  it("keeps only entries inside the root and converts them to forward-slashed relative paths", () => {
    const agentEdits = new Map<string, AgentEditEntry>([
      [path.join(projectRoot, "src", "index.ts"), entry(10)],
      [path.join(tempRoot, "secret.txt"), entry(20)], // sibling, outside projectRoot — must be dropped
    ]);

    const result = changedPathsForRoot(projectRoot, agentEdits, 5, "win32");

    expect(result).toEqual({
      agentPaths: [{ relativePath: "src/index.ts", kind: "file", at: 10 }],
      baselineMs: 5,
    });
  });

  it("matches the root itself only as a prefix, not as a bare string match on an unrelated sibling with the same prefix", () => {
    // "projectRoot-other" starts with the string "projectRoot" but is not inside it.
    const siblingWithSamePrefix = `${projectRoot}-other`;
    const agentEdits = new Map<string, AgentEditEntry>([
      [path.join(siblingWithSamePrefix, "a.ts"), entry()],
    ]);

    expect(changedPathsForRoot(projectRoot, agentEdits, 0, "win32").agentPaths).toEqual([]);
  });

  it("passes baselineMs through unchanged for the renderer's mtime comparison", () => {
    expect(changedPathsForRoot(projectRoot, new Map(), 123456, "win32").baselineMs).toBe(123456);
  });
});
