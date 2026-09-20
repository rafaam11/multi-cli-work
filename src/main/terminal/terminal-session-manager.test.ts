// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { TerminalLaunchSpec } from "../../shared/terminal-types";
import {
  OutputRingBuffer,
  TerminalSessionManager,
  type ManagedPty,
  type ManagedPtyFactory,
} from "./terminal-session-manager";

class FakePty implements ManagedPty {
  readonly pid = 4123;
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();
  private dataListener: (data: string) => void = () => undefined;
  private exitListener: (event: { exitCode: number; signal?: number }) => void = () => undefined;

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListener = listener;
    return { dispose: () => { this.dataListener = () => undefined; } };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.exitListener = listener;
    return { dispose: () => { this.exitListener = () => undefined; } };
  }

  emitData(data: string): void {
    this.dataListener(data);
  }

  emitExit(exitCode: number): void {
    this.exitListener({ exitCode });
  }
}

function launchSpec(): TerminalLaunchSpec {
  return {
    sessionId: "session-1",
    projectId: "project-1",
    tool: null,
    kind: "powershell",
    statusAdapter: "signals",
    cwd: "C:\\Work\\Example",
    executable: "pwsh.exe",
    args: ["-NoLogo"],
    env: { SYSTEMROOT: "C:\\Windows" },
    cols: 100,
    rows: 32,
    createdAt: "2026-07-11T00:00:00.000Z",
  };
}

describe("TerminalSessionManager", () => {
  it("does not kill a PTY again when force release follows stop before its exit event", () => {
    const pty = new FakePty();
    const manager = new TerminalSessionManager({ spawn: () => pty }, () => undefined);
    manager.create(launchSpec());
    manager.stop("session-1");
    manager.release("session-1", undefined, true);
    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(() => manager.attach("session-1")).toThrow(/Unknown terminal/);
  });

  it("retries a failed stop when an explicit release still needs to kill the PTY", () => {
    const pty = new FakePty();
    pty.kill.mockImplementationOnce(() => { throw new Error("kill failed"); });
    const manager = new TerminalSessionManager({ spawn: () => pty }, () => undefined);
    manager.create(launchSpec());
    expect(() => manager.stop("session-1")).toThrow("kill failed");
    manager.release("session-1", undefined, true);
    expect(pty.kill).toHaveBeenCalledTimes(2);
    expect(() => manager.attach("session-1")).toThrow(/Unknown terminal/);
  });
  it("releases repeated exited sessions, replay buffers and PTY subscriptions", () => {
    const events = vi.fn();
    const pty = new FakePty();
    const manager = new TerminalSessionManager({ spawn: () => pty }, events);
    for (let index = 0; index < 4; index++) {
      const sessionId = `released-${index}`;
      manager.create({ ...launchSpec(), sessionId });
      pty.emitData("x".repeat(5 * 1024 * 1024));
      pty.emitExit(0);
      manager.release(sessionId);
      expect(() => manager.attach(sessionId)).toThrow(/Unknown terminal/);
      events.mockClear();
      pty.emitData("late");
      pty.emitExit(1);
      expect(events).not.toHaveBeenCalled();
    }
    expect((manager as unknown as { sessions: Map<string, unknown> }).sessions.size).toBe(0);
  });

  it("disposes replaced listeners and ignores release for an old generation", () => {
    const first = new FakePty();
    const second = new FakePty();
    const factory = { spawn: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) };
    const events = vi.fn();
    const manager = new TerminalSessionManager(factory, events);
    manager.create({ ...launchSpec(), generation: "old" });
    first.emitExit(0);
    manager.create({ ...launchSpec(), generation: "new" });
    manager.release("session-1", "old", true);
    events.mockClear();
    first.emitExit(2);
    first.emitData("stale");
    expect(events).not.toHaveBeenCalled();
    expect(manager.attach("session-1").replay).toBe("");
    expect(second.kill).not.toHaveBeenCalled();
    manager.release("session-1", "new");
    expect(manager.attach("session-1").session.status).toBe("starting");
    manager.release("session-1", "new", true);
    expect(second.kill).toHaveBeenCalledOnce();
    expect(() => manager.attach("session-1")).toThrow(/Unknown terminal/);
  });
  it("seeds restored output into the bounded replay buffer", () => {
    const manager = new TerminalSessionManager({ spawn: () => new FakePty() }, () => undefined, 12);
    manager.create({ ...launchSpec(), initialReplay: "old history\n" });

    expect(manager.attach("session-1").replay).toBe("old history\n");
  });
  it("creates a session and publishes output and lifecycle events", () => {
    const pty = new FakePty();
    const factory: ManagedPtyFactory = { spawn: vi.fn(() => pty) };
    const events = vi.fn();
    const manager = new TerminalSessionManager(factory, events);

    const session = manager.create(launchSpec());
    pty.emitData("PowerShell ready\r\n");
    pty.emitExit(0);

    expect(factory.spawn).toHaveBeenCalledWith("pwsh.exe", ["-NoLogo"], {
      cwd: "C:\\Work\\Example",
      env: { SYSTEMROOT: "C:\\Windows" },
      cols: 100,
      rows: 32,
    });
    expect(session).toMatchObject({ id: "session-1", pid: 4123, status: "starting" });
    expect(events).toHaveBeenCalledWith({
      type: "data",
      sessionId: "session-1",
      data: "PowerShell ready\r\n",
      sequence: 1,
    });
    expect(events).toHaveBeenCalledWith({ type: "status", sessionId: "session-1", status: "idle" });
    expect(events).toHaveBeenCalledWith({ type: "exit", sessionId: "session-1", exitCode: 0 });
  });

  it("forwards input and resize only to the addressed PTY", () => {
    const pty = new FakePty();
    const manager = new TerminalSessionManager({ spawn: () => pty }, () => undefined);
    manager.create(launchSpec());

    manager.write("session-1", "Get-ChildItem\r");
    manager.resize("session-1", 140, 44);

    expect(pty.write).toHaveBeenCalledWith("Get-ChildItem\r");
    expect(pty.resize).toHaveBeenCalledWith(140, 44);
  });

  it("returns bounded replay output when a renderer attaches", () => {
    const pty = new FakePty();
    const manager = new TerminalSessionManager({ spawn: () => pty }, () => undefined, 10);
    manager.create(launchSpec());
    pty.emitData("123456");
    pty.emitData("7890AB");

    const attachment = manager.attach("session-1");

    expect(attachment.replay).toBe("7890AB");
    expect(attachment.sequence).toBe(2);
    expect(Buffer.byteLength(attachment.replay)).toBeLessThanOrEqual(10);
  });

  it("kills a running session and rejects unknown session ids", () => {
    const pty = new FakePty();
    const manager = new TerminalSessionManager({ spawn: () => pty }, () => undefined);
    manager.create(launchSpec());

    manager.stop("session-1");

    expect(pty.kill).toHaveBeenCalledTimes(1);
    expect(() => manager.write("missing", "x")).toThrow(/unknown terminal session/i);
  });

  it("maps Codex OSC notifications and submitted input to unified states", () => {
    const pty = new FakePty();
    const events = vi.fn();
    const manager = new TerminalSessionManager({ spawn: () => pty }, events);
    manager.create({ ...launchSpec(), kind: "codex", statusAdapter: "osc9" });
    pty.emitData("\u001b]9;approval-requested\u0007");
    pty.emitData("\u001b]9;agent-turn-complete\u0007");
    manager.write("session-1", "continue\r");

    expect(events).toHaveBeenCalledWith({
      type: "status",
      sessionId: "session-1",
      status: "awaiting-approval",
    });
    expect(events).toHaveBeenCalledWith({
      type: "status",
      sessionId: "session-1",
      status: "awaiting-input",
    });
    expect(events).toHaveBeenLastCalledWith({ type: "status", sessionId: "session-1", status: "working" });
  });

  it("treats a completed Codex response carried in an OSC 9 payload as input wait", () => {
    const pty = new FakePty();
    const events = vi.fn();
    const manager = new TerminalSessionManager({ spawn: () => pty }, events);
    manager.create({ ...launchSpec(), kind: "codex", statusAdapter: "osc9" });

    manager.write("session-1", "continue\r");
    pty.emitData("\u001b]9;작업을 완료했습니다");
    pty.emitData("\u0007");

    expect(events).toHaveBeenLastCalledWith({ type: "status", sessionId: "session-1", status: "awaiting-input" });
  });

  it("allows an exited tab to be relaunched with the same app session id", () => {
    const first = new FakePty();
    const second = new FakePty();
    const factory: ManagedPtyFactory = { spawn: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second) };
    const manager = new TerminalSessionManager(factory, () => undefined);
    manager.create(launchSpec());
    first.emitExit(0);

    expect(() => manager.create(launchSpec())).not.toThrow();
    expect(factory.spawn).toHaveBeenCalledTimes(2);
  });
});

describe("OutputRingBuffer", () => {
  it("trims multi-byte output on a UTF-8 character boundary instead of splitting it", () => {
    const buffer = new OutputRingBuffer(8);

    buffer.append("Hi가나다");

    expect(Buffer.byteLength(buffer.toString())).toBeLessThanOrEqual(8);
    expect(buffer.toString()).not.toContain("�");
    expect(buffer.toString()).toBe("나다");
  });
});
