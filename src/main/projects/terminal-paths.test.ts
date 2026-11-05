import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerminalPathService } from "./terminal-paths";

const created: string[] = [];
afterEach(async () => { for (const dir of created.splice(0)) await fs.rm(dir, { recursive: true, force: true }); });

describe("terminal printed paths", () => {
  it("opens an outside result with the OS and rechecks deletion at click time", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-path-"));
    created.push(dir);
    const result = path.join(dir, "설계 노트.pdf");
    await fs.writeFile(result, "result");
    const openPath = vi.fn(async () => "");
    const reveal = vi.fn();
    const service = createTerminalPathService({ context: async () => ({ cwd: dir }), openPath, reveal, platform: process.platform });
    expect(await service.resolve("session", result)).toEqual({ raw: result, kind: "file" });
    await service.open("session", result);
    expect(openPath).toHaveBeenCalledWith(result);
    await fs.rm(result);
    await expect(service.open("session", result)).rejects.toThrow();
    expect(openPath).toHaveBeenCalledTimes(1);
  });

  it("reveals executable files and falls back to reveal if the OS cannot open a file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-path-"));
    created.push(dir);
    const script = path.join(dir, "run.cmd");
    const document = path.join(dir, "report.pdf");
    await Promise.all([fs.writeFile(script, ""), fs.writeFile(document, "")]);
    const reveal = vi.fn();
    const openPath = vi.fn(async () => "no association");
    const service = createTerminalPathService({ context: async () => ({ cwd: dir }), openPath, reveal, platform: "win32" });
    // Windows path semantics are verified by unit tests on Windows; use native paths here.
    if (process.platform !== "win32") return;
    await service.open("session", script);
    await service.open("session", document);
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledTimes(2);
  });
});
