// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalWorkerRequest, TerminalWorkerResponse } from "../../shared/terminal-types";
import { RestartingTerminalWorker, type RestartableTerminalWorkerTransport } from "./restarting-terminal-worker";

class FakeTransport implements RestartableTerminalWorkerTransport {
  readonly sent: TerminalWorkerRequest[] = [];
  readonly kill = vi.fn(() => true);
  private readonly messageListeners: Array<(message: unknown) => void> = [];
  private readonly exitListeners: Array<(code: number) => void> = [];

  postMessage(message: TerminalWorkerRequest): void {
    this.sent.push(message);
  }

  on(event: "message" | "exit", listener: ((message: unknown) => void) | ((code: number) => void)): this {
    if (event === "message") this.messageListeners.push(listener as (message: unknown) => void);
    else this.exitListeners.push(listener as (code: number) => void);
    return this;
  }

  emitMessage(message: unknown): void {
    this.messageListeners.forEach((listener) => listener(message));
  }

  emitExit(code: number): void {
    this.exitListeners.forEach((listener) => listener(code));
  }
}

function spawnQueue(transports: FakeTransport[]) {
  const spawn = vi.fn();
  transports.forEach((transport) => spawn.mockReturnValueOnce(transport));
  return spawn;
}

describe("RestartingTerminalWorker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a crash, backs off 500ms, replaces the transport, and serves the next request", async () => {
    const first = new FakeTransport();
    const second = new FakeTransport();
    const spawn = spawnQueue([first, second]);
    const worker = new RestartingTerminalWorker(spawn);
    const exits = vi.fn();
    worker.onExit(exits);

    first.emitExit(17);

    expect(exits).toHaveBeenCalledWith(17);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(() => worker.write("session-1", "retry")).toThrow(/unavailable/);

    await vi.advanceTimersByTimeAsync(500);

    expect(spawn).toHaveBeenCalledTimes(2);
    const pending = worker.write("session-1", "retry");
    expect(second.sent).toHaveLength(1);
    const response: TerminalWorkerResponse = { requestId: second.sent[0].requestId, ok: true };
    second.emitMessage(response);
    await expect(pending).resolves.toBeUndefined();
  });

  it("forwards events only from the current transport and does not restart after dispose", () => {
    const first = new FakeTransport();
    const second = new FakeTransport();
    const third = new FakeTransport();
    const spawn = spawnQueue([first, second, third]);
    const worker = new RestartingTerminalWorker(spawn);
    const events = vi.fn();
    worker.onEvent(events);

    first.emitExit(1);
    vi.advanceTimersByTime(500);
    first.emitMessage({ type: "status", sessionId: "old", status: "working" });
    second.emitMessage({ type: "status", sessionId: "current", status: "idle" });

    expect(events).toHaveBeenCalledOnce();
    expect(events).toHaveBeenCalledWith({ type: "status", sessionId: "current", status: "idle" });

    worker.dispose();
    second.emitExit(0);
    vi.advanceTimersByTime(10_000);
    expect(second.kill).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("follows the exponential backoff schedule and stops respawning after 5 consecutive crashes", () => {
    const transports = Array.from({ length: 6 }, () => new FakeTransport());
    const spawn = spawnQueue(transports);
    new RestartingTerminalWorker(spawn);

    expect(spawn).toHaveBeenCalledTimes(1);

    const delays = [500, 1000, 2000, 4000, 8000];
    for (const [i, delay] of delays.entries()) {
      transports[i].emitExit(1);
      vi.advanceTimersByTime(delay - 1);
      expect(spawn).toHaveBeenCalledTimes(i + 1);
      vi.advanceTimersByTime(1);
      expect(spawn).toHaveBeenCalledTimes(i + 2);
    }

    // 6th consecutive crash exceeds the cap of 5: no further respawn, however long we wait.
    transports[5].emitExit(1);
    vi.advanceTimersByTime(60_000);
    expect(spawn).toHaveBeenCalledTimes(6);
  });

  it("throws a fixed restartError once the consecutive crash cap is exceeded", () => {
    const transports = Array.from({ length: 6 }, () => new FakeTransport());
    const spawn = spawnQueue(transports);
    const worker = new RestartingTerminalWorker(spawn);

    for (const [i, delay] of [500, 1000, 2000, 4000, 8000].entries()) {
      transports[i].emitExit(1);
      vi.advanceTimersByTime(delay);
    }
    transports[5].emitExit(1);

    expect(() => worker.write("session-1", "x")).toThrow(
      /Terminal worker crashed 5 times consecutively; giving up/,
    );
  });

  it("resets the consecutive crash counter after the worker survives 30 seconds", () => {
    const first = new FakeTransport();
    const second = new FakeTransport();
    const third = new FakeTransport();
    const spawn = spawnQueue([first, second, third]);
    new RestartingTerminalWorker(spawn);

    first.emitExit(1); // 1st consecutive crash -> 500ms backoff
    vi.advanceTimersByTime(500);
    expect(spawn).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(30_000); // second survives long enough to reset the counter

    second.emitExit(1); // should be treated as a fresh 1st crash -> 500ms again, not 1000ms
    vi.advanceTimersByTime(499);
    expect(spawn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(spawn).toHaveBeenCalledTimes(3);
  });

  it("cancels pending restart and survival timers on dispose", () => {
    const first = new FakeTransport();
    const second = new FakeTransport();
    const spawn = spawnQueue([first, second]);
    const worker = new RestartingTerminalWorker(spawn);

    first.emitExit(1);
    worker.dispose();
    vi.advanceTimersByTime(60_000);

    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
