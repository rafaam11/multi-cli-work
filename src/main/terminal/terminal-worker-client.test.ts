// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { TerminalLaunchSpec, TerminalWorkerRequest, TerminalWorkerResponse } from "../../shared/terminal-types";
import { TerminalWorkerClient, type TerminalWorkerTransport } from "./terminal-worker-client";

class FakeWorker implements TerminalWorkerTransport {
  readonly sent: TerminalWorkerRequest[] = [];
  private messageListeners: Array<(message: unknown) => void> = [];
  private exitListeners: Array<(code: number) => void> = [];

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

const spec: TerminalLaunchSpec = {
  sessionId: "session-1",
  projectId: "project-1",
  kind: "powershell",
  cwd: "C:\\Work",
  executable: "pwsh.exe",
  args: ["-NoLogo"],
  env: {},
  cols: 80,
  rows: 24,
  createdAt: "2026-07-11T00:00:00.000Z",
};

describe("TerminalWorkerClient", () => {
  it("correlates requests with worker responses", async () => {
    const worker = new FakeWorker();
    const client = new TerminalWorkerClient(worker, { idFactory: () => "request-1" });

    const pending = client.create(spec);
    expect(worker.sent).toEqual([{ requestId: "request-1", type: "create", spec }]);
    const response: TerminalWorkerResponse = {
      requestId: "request-1",
      ok: true,
      result: {
        id: "session-1",
        projectId: "project-1",
        kind: "powershell",
        cwd: "C:\\Work",
        providerConversationId: null,
        status: "starting",
        pid: 10,
        createdAt: spec.createdAt,
        updatedAt: spec.createdAt,
        exitCode: null,
      },
    };
    worker.emitMessage(response);

    await expect(pending).resolves.toMatchObject({ id: "session-1", status: "starting" });
  });

  it("forwards asynchronous terminal events to subscribers", () => {
    const worker = new FakeWorker();
    const client = new TerminalWorkerClient(worker);
    const received: unknown[] = [];
    client.onEvent((event) => received.push(event));

    worker.emitMessage({ type: "status", sessionId: "session-1", status: "awaiting-input" });

    expect(received).toEqual([{ type: "status", sessionId: "session-1", status: "awaiting-input" }]);
  });

  it("rejects pending calls if the worker exits", async () => {
    const worker = new FakeWorker();
    const client = new TerminalWorkerClient(worker, { idFactory: () => "request-1" });
    const pending = client.create(spec);

    worker.emitExit(7);

    await expect(pending).rejects.toThrow(/worker exited.*7/i);
  });
});

