// @vitest-environment node

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { CodeServeWebManager } from "./code-serve-web";

/** A ChildProcess stand-in that emits a readiness line one tick after it is spawned. */
function fakeChild(readyLine: string | null) {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    killed: boolean;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
  };
  child.pid = 4321;
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => {
    child.killed = true;
  });
  if (readyLine) {
    // After the current tick, so ensure() has attached its stdout listener first.
    setTimeout(() => child.stdout.emit("data", Buffer.from(readyLine)), 0);
  }
  return child;
}

describe("CodeServeWebManager", () => {
  it("throws when VS Code is not found", async () => {
    const manager = new CodeServeWebManager({ resolveCodeCli: async () => null });
    await expect(manager.ensure()).rejects.toThrow(/VS Code was not found/);
  });

  it("resolves once the readiness line prints and reuses the same endpoint", async () => {
    // The real serve-web line has no slash before the query — the readiness matcher must accept that.
    const spawnProcess = vi.fn(() => fakeChild("Web UI available at http://127.0.0.1:59999?tkn=deadbeef"));
    const manager = new CodeServeWebManager({
      resolveCodeCli: async () => "C:\\VS Code\\bin\\code.cmd",
      spawnProcess: spawnProcess as never,
    });

    const first = await manager.ensure();
    expect(first.token).toMatch(/^[0-9a-f]+$/);
    expect(first.port).toBeGreaterThan(0);

    const second = await manager.ensure();
    expect(second).toEqual(first);
    // The server is spawned once and reused, not per call.
    expect(spawnProcess).toHaveBeenCalledOnce();
  });

  it("passes serve-web with the allocated port and generated token", async () => {
    let capturedArgs: string[] = [];
    const spawnProcess = vi.fn((_command: string, args: string[]) => {
      capturedArgs = args;
      return fakeChild("Web UI available at http://127.0.0.1:1/?tkn=x");
    });
    const manager = new CodeServeWebManager({
      resolveCodeCli: async () => "C:\\VS Code\\bin\\code.cmd",
      spawnProcess: spawnProcess as never,
    });

    const endpoint = await manager.ensure();
    expect(capturedArgs).toContain("serve-web");
    expect(capturedArgs).toContain("--accept-server-license-terms");
    expect(capturedArgs[capturedArgs.indexOf("--port") + 1]).toBe(String(endpoint.port));
    expect(capturedArgs[capturedArgs.indexOf("--connection-token") + 1]).toBe(endpoint.token);
  });

  it("builds a workbench URL with a POSIX folder path from a Windows path", () => {
    const manager = new CodeServeWebManager({ resolveCodeCli: async () => null });
    const url = manager.folderUrl({ port: 5555, token: "tok" }, "D:\\Project\\multi-cli-work");
    const parsed = new URL(url);
    expect(parsed.host).toBe("127.0.0.1:5555");
    expect(parsed.searchParams.get("tkn")).toBe("tok");
    expect(parsed.searchParams.get("folder")).toBe("/D:/Project/multi-cli-work");
  });

  it("rejects when the process exits before printing the readiness line", async () => {
    const child = fakeChild(null);
    const manager = new CodeServeWebManager({
      resolveCodeCli: async () => "code.cmd",
      spawnProcess: (() => {
        setTimeout(() => child.emit("exit", 1), 0);
        return child;
      }) as never,
    });
    await expect(manager.ensure()).rejects.toThrow(/exited before becoming ready/);
  });
});
