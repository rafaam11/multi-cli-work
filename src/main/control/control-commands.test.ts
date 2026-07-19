// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { TerminalSessionView } from "../../shared/api-types";
import type { TerminalEvent } from "../../shared/terminal-types";
import { handleControlCommand, type ControlCommandContext } from "./control-commands";

function session(overrides: Partial<TerminalSessionView>): TerminalSessionView {
  return {
    id: "session-1",
    projectId: "project-1",
    tool: null,
    title: null,
    name: null,
    kind: "claude",
    cwd: "C:\\Work",
    providerConversationId: null,
    interruptedByShutdown: false,
    status: "idle",
    pid: 100,
    exitCode: null,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  };
}

function makeContext(overrides: Partial<ControlCommandContext> = {}) {
  const listeners = new Set<(event: TerminalEvent) => void>();
  const context: ControlCommandContext = {
    sessions: () => [session({})],
    write: vi.fn(async () => undefined),
    readReplay: vi.fn(async () => "line1\nline2\nline3"),
    create: vi.fn(async () => session({ id: "session-spawned", status: "starting" })),
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    projectName: vi.fn(async (projectId: string) => (projectId === "project-1" ? "Atlas" : null)),
    ...overrides,
  };
  return {
    context,
    emit(event: TerminalEvent) {
      for (const listener of listeners) listener(event);
    },
    listeners,
  };
}

const TOKEN = { token: "t" };

describe("list", () => {
  it("maps sessions with their project name and filters by project", async () => {
    const sessions = [
      session({}),
      session({ id: "session-2", projectId: "project-2", kind: "powershell" }),
    ];
    const { context } = makeContext({ sessions: () => sessions });

    const all = await handleControlCommand({ ...TOKEN, command: "list" }, context);
    expect(all).toMatchObject({
      ok: true,
      result: {
        sessions: [
          { id: "session-1", kind: "claude", status: "idle", projectName: "Atlas" },
          { id: "session-2", projectName: null },
        ],
      },
    });

    const filtered = await handleControlCommand(
      { ...TOKEN, command: "list", args: { projectId: "project-2" } },
      context,
    );
    expect(filtered).toMatchObject({ ok: true, result: { sessions: [{ id: "session-2" }] } });
  });
});

describe("send", () => {
  it("encodes the prompt as terminal input and writes it to the target", async () => {
    const { context } = makeContext();

    const response = await handleControlCommand(
      { ...TOKEN, callerSessionId: "session-caller", command: "send", args: { sessionId: "session-1", text: "빌드 돌려줘" } },
      context,
    );

    expect(response).toEqual({ ok: true, result: { sessionId: "session-1" } });
    expect(context.write).toHaveBeenCalledWith("session-1", "빌드 돌려줘\r");
  });

  it("wraps a multiline prompt in one bracketed paste", async () => {
    const { context } = makeContext();

    await handleControlCommand(
      { ...TOKEN, command: "send", args: { sessionId: "session-1", text: "첫 줄\n둘째 줄" } },
      context,
    );

    expect(context.write).toHaveBeenCalledWith("session-1", "[200~첫 줄\n둘째 줄[201~\r");
  });

  it("refuses to send to the caller itself, to unknown sessions, and to finished ones", async () => {
    const { context } = makeContext({
      sessions: () => [session({}), session({ id: "session-dead", status: "exited", pid: null })],
    });

    const self = await handleControlCommand(
      { ...TOKEN, callerSessionId: "session-1", command: "send", args: { sessionId: "session-1", text: "x" } },
      context,
    );
    expect(self).toMatchObject({ ok: false, error: expect.stringContaining("자기 자신") });

    const unknown = await handleControlCommand(
      { ...TOKEN, command: "send", args: { sessionId: "missing", text: "x" } },
      context,
    );
    expect(unknown).toMatchObject({ ok: false, error: expect.stringContaining("알 수 없는 세션") });

    const dead = await handleControlCommand(
      { ...TOKEN, command: "send", args: { sessionId: "session-dead", text: "x" } },
      context,
    );
    expect(dead).toMatchObject({ ok: false, error: expect.stringContaining("입력을 받을 수 없습니다") });
    expect(context.write).not.toHaveBeenCalled();
  });
});

describe("read", () => {
  it("returns the tail of the session's scrollback", async () => {
    const { context } = makeContext();

    const response = await handleControlCommand(
      { ...TOKEN, command: "read", args: { sessionId: "session-1", lines: 2 } },
      context,
    );

    expect(response).toEqual({ ok: true, result: { sessionId: "session-1", text: "line2\nline3" } });
  });

  it("rejects a non-positive line count", async () => {
    const { context } = makeContext();
    const response = await handleControlCommand(
      { ...TOKEN, command: "read", args: { sessionId: "session-1", lines: 0 } },
      context,
    );
    expect(response).toMatchObject({ ok: false, error: expect.stringContaining("lines") });
  });
});

describe("wait", () => {
  it("returns immediately when the session is already in a settling state", async () => {
    const { context } = makeContext({ sessions: () => [session({ status: "awaiting-input" })] });

    const response = await handleControlCommand(
      { ...TOKEN, command: "wait", args: { sessionId: "session-1" } },
      context,
    );

    expect(response).toEqual({ ok: true, result: { sessionId: "session-1", status: "awaiting-input" } });
  });

  it("resolves when the awaited status arrives, and unsubscribes afterwards", async () => {
    const harness = makeContext({ sessions: () => [session({ status: "working" })] });

    const pending = handleControlCommand(
      { ...TOKEN, command: "wait", args: { sessionId: "session-1", status: "idle" } },
      harness.context,
    );
    await Promise.resolve();
    harness.emit({ type: "status", sessionId: "other", status: "idle" });
    harness.emit({ type: "status", sessionId: "session-1", status: "working" });
    harness.emit({ type: "status", sessionId: "session-1", status: "idle" });

    await expect(pending).resolves.toEqual({ ok: true, result: { sessionId: "session-1", status: "idle" } });
    expect(harness.listeners.size).toBe(0);
  });

  it("settles on termination even when waiting for something else", async () => {
    const harness = makeContext({ sessions: () => [session({ status: "working" })] });

    const pending = handleControlCommand(
      { ...TOKEN, command: "wait", args: { sessionId: "session-1", status: "idle" } },
      harness.context,
    );
    await Promise.resolve();
    harness.emit({ type: "exit", sessionId: "session-1", exitCode: 0 });

    await expect(pending).resolves.toEqual({ ok: true, result: { sessionId: "session-1", status: "exited" } });
  });

  it("fails after the timeout instead of hanging forever", async () => {
    const harness = makeContext({ sessions: () => [session({ status: "working" })] });

    const response = await handleControlCommand(
      { ...TOKEN, command: "wait", args: { sessionId: "session-1", timeoutSeconds: 0.02 } },
      harness.context,
    );

    expect(response).toMatchObject({ ok: false, error: expect.stringContaining("시간 초과") });
    expect(harness.listeners.size).toBe(0);
  });

  it("rejects an unknown status name", async () => {
    const { context } = makeContext();
    const response = await handleControlCommand(
      { ...TOKEN, command: "wait", args: { sessionId: "session-1", status: "done" } },
      context,
    );
    expect(response).toMatchObject({ ok: false, error: expect.stringContaining("알 수 없는 상태") });
  });
});

describe("spawn", () => {
  it("creates the session at the default size and reports its id", async () => {
    const { context } = makeContext();

    const response = await handleControlCommand(
      { ...TOKEN, command: "spawn", args: { projectId: "project-1", kind: "claude", worktreeId: "worktree-1" } },
      context,
    );

    expect(context.create).toHaveBeenCalledWith({
      projectId: "project-1",
      kind: "claude",
      worktreeId: "worktree-1",
      cols: 80,
      rows: 24,
    });
    expect(response).toMatchObject({ ok: true, result: { sessionId: "session-spawned" } });
  });

  it("surfaces coordinator errors as command failures", async () => {
    const { context } = makeContext({
      create: vi.fn(async () => {
        throw new Error("Unknown project: nope");
      }),
    });
    const response = await handleControlCommand(
      { ...TOKEN, command: "spawn", args: { projectId: "nope", kind: "claude" } },
      context,
    );
    expect(response).toEqual({ ok: false, error: "Unknown project: nope" });
  });
});

describe("dispatch", () => {
  it("rejects unknown commands", async () => {
    const { context } = makeContext();
    const response = await handleControlCommand({ ...TOKEN, command: "stop" }, context);
    expect(response).toMatchObject({ ok: false, error: expect.stringContaining("알 수 없는 명령") });
  });
});
