// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
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

describe("RestartingTerminalWorker", () => {
  it("reports a crash, replaces the transport, and serves the next request", async () => {
    const first = new FakeTransport();
    const second = new FakeTransport();
    const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const worker = new RestartingTerminalWorker(spawn);
    const exits = vi.fn();
    worker.onExit(exits);

    first.emitExit(17);

    expect(exits).toHaveBeenCalledWith(17);
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
    const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(third);
    const worker = new RestartingTerminalWorker(spawn);
    const events = vi.fn();
    worker.onEvent(events);

    first.emitExit(1);
    first.emitMessage({ type: "status", sessionId: "old", status: "working" });
    second.emitMessage({ type: "status", sessionId: "current", status: "idle" });

    expect(events).toHaveBeenCalledOnce();
    expect(events).toHaveBeenCalledWith({ type: "status", sessionId: "current", status: "idle" });

    worker.dispose();
    second.emitExit(0);
    expect(second.kill).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
