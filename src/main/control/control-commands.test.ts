// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { TerminalSessionView } from "../../shared/api-types";
import type { SessionIndicators, StatusChip, TerminalEvent } from "../../shared/terminal-types";
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
    indicators: vi.fn((): SessionIndicators => ({ progress: null, chips: [] })),
    setChip: vi.fn(),
    clearChips: vi.fn(),
    setProgress: vi.fn(),
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

describe("status", () => {
  it("pins a chip on the calling session, trimmed and stripped of control characters", async () => {
    const { context } = makeContext();
    const response = await handleControlCommand(
      { ...TOKEN, callerSessionId: "session-1", command: "status", args: { action: "set", key: "build", text: "  빌드\u001b[31m 중  ", color: "amber" } },
      context,
    );
    expect(response).toEqual({ ok: true, result: { sessionId: "session-1" } });
    expect(context.setChip).toHaveBeenCalledWith("session-1", { key: "build", text: "빌드[31m 중", color: "amber" });
  });

  it("targets another session with sessionId, defaults the colour, and shortens long text", async () => {
    const { context } = makeContext({ sessions: () => [session({}), session({ id: "session-2" })] });
    await handleControlCommand(
      { ...TOKEN, callerSessionId: "session-1", command: "status", args: { action: "set", sessionId: "session-2", key: "t", text: "x".repeat(60) } },
      context,
    );
    expect(context.setChip).toHaveBeenCalledWith("session-2", { key: "t", text: `${"x".repeat(39)}…`, color: "blue" });
  });

  it("rejects a bad key or colour, a ninth chip, and a session that has ended", async () => {
    const full: StatusChip[] = Array.from({ length: 8 }, (_, index) => ({ key: `k${index}`, text: "x", color: "gray" }));
    const { context } = makeContext({
      sessions: () => [session({}), session({ id: "dead", status: "exited", pid: null })],
      indicators: () => ({ progress: null, chips: full }),
    });
    const set = (args: Record<string, unknown>) =>
      handleControlCommand({ ...TOKEN, callerSessionId: "session-1", command: "status", args: { action: "set", text: "x", ...args } }, context);
    expect(await set({ key: "with space" })).toMatchObject({ ok: false, error: expect.stringContaining("key") });
    expect(await set({ key: "ok", color: "pink" })).toMatchObject({ ok: false, error: expect.stringContaining("색") });
    expect(await set({ key: "new" })).toMatchObject({ ok: false, error: expect.stringContaining("8개") });
    expect(await set({ key: "k1" })).toEqual({ ok: true, result: { sessionId: "session-1" } });
    expect(await set({ key: "x", sessionId: "dead" })).toMatchObject({ ok: false });
  });

  it("clears one chip by key or all of them", async () => {
    const { context } = makeContext();
    await handleControlCommand({ ...TOKEN, callerSessionId: "session-1", command: "status", args: { action: "clear", key: "build" } }, context);
    await handleControlCommand({ ...TOKEN, callerSessionId: "session-1", command: "status", args: { action: "clear" } }, context);
    expect(context.clearChips).toHaveBeenNthCalledWith(1, "session-1", "build");
    expect(context.clearChips).toHaveBeenNthCalledWith(2, "session-1", undefined);
  });

  it("needs a session to act on when called from outside one", async () => {
    const { context } = makeContext();
    expect(await handleControlCommand({ ...TOKEN, command: "status", args: { action: "clear" } }, context)).toMatchObject({
      ok: false,
      error: expect.stringContaining("--session"),
    });
  });
});

describe("progress", () => {
  it("sets a value, a busy bar, a state, and clears", async () => {
    const { context } = makeContext();
    const run = (args: Record<string, unknown>) =>
      handleControlCommand({ ...TOKEN, callerSessionId: "session-1", command: "progress", args }, context);
    await run({ value: 40 });
    await run({ value: 70, state: "error" });
    await run({ state: "indeterminate" });
    await run({ clear: true });
    expect(vi.mocked(context.setProgress).mock.calls).toEqual([
      ["session-1", { state: "normal", value: 40 }],
      ["session-1", { state: "error", value: 70 }],
      ["session-1", { state: "indeterminate", value: null }],
      ["session-1", null],
    ]);
  });

  it("rejects a value outside 0 to 100 and an unknown state", async () => {
    const { context } = makeContext();
    const run = (args: Record<string, unknown>) =>
      handleControlCommand({ ...TOKEN, callerSessionId: "session-1", command: "progress", args }, context);
    expect(await run({ value: 101 })).toMatchObject({ ok: false });
    expect(await run({ value: 1.5 })).toMatchObject({ ok: false });
    expect(await run({ value: 5, state: "done" })).toMatchObject({ ok: false });
    expect(context.setProgress).not.toHaveBeenCalled();
  });
});
