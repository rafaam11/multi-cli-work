import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeScripts } from "../../shared/worktree-types";
import { scriptFileContent, WorktreeScriptRunner, type ScriptChild } from "./worktree-script-runner";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-script-runner-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const worktree = { id: "wt-1", projectId: "p1", path: "C:\\repo-wt\\feature", branch: "feature/x" };
const project = { id: "p1", rootPath: "C:\\repo" };

function fakeChild(): ScriptChild & { stdout: PassThrough; stderr: PassThrough; finish(code: number | null): void } {
  const emitter = new EventEmitter() as ScriptChild & { stdout: PassThrough; stderr: PassThrough; finish(code: number | null): void };
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.kill = vi.fn(() => {
    emitter.finish(null);
    return true;
  });
  emitter.finish = (code) => emitter.emit("close", code);
  return emitter;
}

function runner(scripts: WorktreeScripts | null, overrides: Partial<ConstructorParameters<typeof WorktreeScriptRunner>[0]> = {}) {
  const coordinator = {
    create: vi.fn(async () => ({ id: "setup-session" })),
    rename: vi.fn(async () => undefined),
    attachForRenderer: vi.fn(async () => undefined),
    write: vi.fn(async () => undefined),
  };
  const instance = new WorktreeScriptRunner({
    platform: "win32",
    scriptsDir: dir,
    readScripts: async () => scripts,
    coordinator,
    shellExecutable: async () => "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    spawn: vi.fn(() => fakeChild()),
    ...overrides,
  });
  return { instance, coordinator };
}

describe("scriptFileContent", () => {
  it("prefixes the worktree's paths as environment variables, quoted for each shell", () => {
    const env = { MCW_ROOT_PATH: "C:\\it's", MCW_WORKTREE_PATH: "C:\\wt", MCW_BRANCH: "b" };
    expect(scriptFileContent("win32", env, "npm ci")).toBe(
      "$env:MCW_ROOT_PATH = 'C:\\it''s'\r\n$env:MCW_WORKTREE_PATH = 'C:\\wt'\r\n$env:MCW_BRANCH = 'b'\r\nnpm ci\r\n",
    );
    expect(scriptFileContent("linux", { ...env, MCW_ROOT_PATH: "/it's" }, "npm ci")).toBe(
      "export MCW_ROOT_PATH='/it'\\''s'\nexport MCW_WORKTREE_PATH='C:\\wt'\nexport MCW_BRANCH='b'\nnpm ci\n",
    );
  });
});

describe("WorktreeScriptRunner.runSetup", () => {
  it("runs the folder's setup script in a visible shell session in the new worktree", async () => {
    const { instance, coordinator } = runner({ setup: "npm ci", teardown: "", teardownTimeoutSec: 60 });
    expect(await instance.runSetup(worktree, project)).toBe("setup-session");

    expect(coordinator.create).toHaveBeenCalledWith(
      { projectId: "p1", worktreeId: "wt-1", kind: "powershell", cols: 120, rows: 36, background: true },
      { updateSelection: false },
    );
    expect(coordinator.rename).toHaveBeenCalledWith("setup-session", "셋업 · feature/x");
    const script = path.join(dir, "wt-1-setup.ps1");
    expect(coordinator.write).toHaveBeenCalledWith(
      "setup-session",
      `& (Get-Process -Id $PID).Path -NoProfile -ExecutionPolicy Bypass -File '${script}'\r`,
    );
    const written = await fs.readFile(script);
    // Windows PowerShell 5.1 reads a BOM-less script as the ANSI code page — Korean would break.
    expect([...written.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(written.toString("utf8")).toContain("npm ci");
  });

  it("does nothing for a folder without a setup script", async () => {
    const { instance, coordinator } = runner({ setup: "  ", teardown: "x", teardownTimeoutSec: 60 });
    expect(await instance.runSetup(worktree, project)).toBeNull();
    expect(coordinator.create).not.toHaveBeenCalled();
    expect(await runner(null).instance.runSetup(worktree, project)).toBeNull();
  });
});

describe("WorktreeScriptRunner.runTeardown", () => {
  it("runs the teardown script hidden in the worktree and reports success", async () => {
    const child = fakeChild();
    const spawn = vi.fn(() => child);
    const { instance } = runner({ setup: "", teardown: "Remove-Item .cache", teardownTimeoutSec: 60 }, { spawn });
    const result = instance.runTeardown(worktree, project);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
    child.finish(0);
    expect(await result).toEqual({ ok: true });
    const [command, args, options] = spawn.mock.calls[0] as unknown as [string, string[], { cwd: string; windowsHide: boolean }];
    expect(command).toBe("C:\\Program Files\\PowerShell\\7\\pwsh.exe");
    expect(args).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(dir, "wt-1-teardown.ps1")]);
    expect(options).toMatchObject({ cwd: worktree.path, windowsHide: true });
  });

  it("reports a failing exit with the tail of its output", async () => {
    const child = fakeChild();
    const { instance } = runner({ setup: "", teardown: "exit 3", teardownTimeoutSec: 60 }, { spawn: vi.fn(() => child) });
    const result = instance.runTeardown(worktree, project);
    await vi.waitFor(() => expect(child.listenerCount("close")).toBeGreaterThan(0));
    child.stdout.write("x".repeat(5_000));
    child.stderr.write("boom");
    child.finish(3);
    const outcome = await result;
    expect(outcome).toMatchObject({ ok: false, message: "정리 스크립트가 코드 3으로 끝났습니다." });
    expect(outcome.ok === false && outcome.output.length).toBeLessThanOrEqual(4_096);
    expect(outcome.ok === false && outcome.output.endsWith("boom")).toBe(true);
  });

  it("kills a teardown that runs past its timeout", async () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const { instance } = runner({ setup: "", teardown: "sleep", teardownTimeoutSec: 5 }, { spawn: vi.fn(() => child) });
      const result = instance.runTeardown(worktree, project);
      await vi.waitFor(() => expect(child.listenerCount("close")).toBeGreaterThan(0));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(child.kill).toHaveBeenCalled();
      expect(await result).toMatchObject({ ok: false, message: "정리 스크립트가 5초 안에 끝나지 않았습니다." });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a shell that cannot be started", async () => {
    const spawn = vi.fn(() => {
      throw new Error("ENOENT");
    });
    const { instance } = runner({ setup: "", teardown: "x", teardownTimeoutSec: 60 }, { spawn });
    expect(await instance.runTeardown(worktree, project)).toEqual({
      ok: false,
      message: "정리 스크립트를 시작하지 못했습니다: ENOENT",
      output: "",
    });
  });

  it("succeeds at once when the folder has no teardown script", async () => {
    const spawn = vi.fn();
    const { instance } = runner({ setup: "npm ci", teardown: "", teardownTimeoutSec: 60 }, { spawn });
    expect(await instance.runTeardown(worktree, project)).toEqual({ ok: true });
    expect(spawn).not.toHaveBeenCalled();
  });
});
