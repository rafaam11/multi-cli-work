// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { TerminalSessionView } from "../../shared/api-types";
import type { SessionIndicators, StatusChip, TerminalEvent } from "../../shared/terminal-types";
import { handleControlCommand, type ControlCommandContext } from "./control-commands";
import type { DeliveryRecord, DeliveryRequest } from "./delivery-queue";

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

function record(overrides: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    id: "message-1",
    from: null,
    to: "session-1",
    text: "x",
    state: "delivered",
    reason: null,
    createdAt: 0,
    settledAt: 0,
    ...overrides,
  };
}

function makeDelivery(): ControlCommandContext["delivery"] {
  return {
    enqueue: vi.fn(async (request: DeliveryRequest) => record({ to: request.to, text: request.text, from: request.from ?? null })),
    held: vi.fn(() => []),
    drop: vi.fn(() => null),
    waitFor: vi.fn(async (id: string) => record({ id })),
  };
}

function makeContext(overrides: Partial<ControlCommandContext> = {}) {
  const listeners = new Set<(event: TerminalEvent) => void>();
  const context: ControlCommandContext = {
    sessions: () => [session({})],
    delivery: makeDelivery(),
    board: {
      recordDirect: vi.fn(async () => undefined),
      post: vi.fn(async (request) => ({
        id: "post-1",
        projectId: request.projectId,
        author: { kind: "user" as const },
        kind: "post" as const,
        text: request.text,
        to: request.mentions.map((sessionId: string) => ({ sessionId, name: sessionId, agent: "claude" })),
        createdAt: "2026-10-18T00:00:00.000Z",
      })),
      list: vi.fn(async () => []),
    },
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
  it("hands the text to the delivery queue with the caller as sender", async () => {
    const { context } = makeContext();

    const response = await handleControlCommand(
      { ...TOKEN, callerSessionId: "session-caller", command: "send", args: { sessionId: "session-1", text: "빌드 돌려줘" } },
      context,
    );

    expect(response).toEqual({
      ok: true,
      result: { sessionId: "session-1", id: "message-1", outcome: "delivered", reason: null },
    });
    expect(context.delivery.enqueue).toHaveBeenCalledWith({
      to: "session-1",
      text: "빌드 돌려줘",
      from: "session-caller",
      raw: false,
      urgent: false,
    });
  });

  it("passes --now and --raw through and waits for a held message when asked", async () => {
    const { context } = makeContext();
    vi.mocked(context.delivery.enqueue).mockResolvedValueOnce(record({ state: "held", reason: "working" }));

    const response = await handleControlCommand(
      { ...TOKEN, command: "send", args: { sessionId: "session-1", text: "x", now: true, raw: true, waitSeconds: 5 } },
      context,
    );

    expect(context.delivery.enqueue).toHaveBeenCalledWith(expect.objectContaining({ raw: true, urgent: true }));
    expect(context.delivery.waitFor).toHaveBeenCalledWith("message-1", 5000);
    expect(response).toMatchObject({ ok: true, result: { outcome: "delivered" } });
  });

  it("reports a held message without waiting by default", async () => {
    const { context } = makeContext();
    vi.mocked(context.delivery.enqueue).mockResolvedValueOnce(record({ state: "held", reason: "typing" }));

    const response = await handleControlCommand(
      { ...TOKEN, command: "send", args: { sessionId: "session-1", text: "x" } },
      context,
    );

    expect(response).toMatchObject({ ok: true, result: { outcome: "held", reason: "typing" } });
    expect(context.delivery.waitFor).not.toHaveBeenCalled();
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
    expect(context.delivery.enqueue).not.toHaveBeenCalled();
  });
});

describe("broadcast", () => {
  const sessions = [
    session({ id: "caller" }),
    session({ id: "peer-claude" }),
    session({ id: "peer-codex", kind: "codex" }),
    session({ id: "elsewhere", projectId: "project-2" }),
    session({ id: "dead", status: "exited", pid: null }),
  ];

  it("defaults to the caller's folder and skips the caller and finished sessions", async () => {
    const { context } = makeContext({ sessions: () => sessions });
    const response = await handleControlCommand(
      { ...TOKEN, callerSessionId: "caller", command: "broadcast", args: { text: "점검" } },
      context,
    );
    expect(vi.mocked(context.delivery.enqueue).mock.calls.map(([request]) => request.to)).toEqual(["peer-claude", "peer-codex"]);
    expect(response).toMatchObject({ ok: true, result: { messages: [{ sessionId: "peer-claude" }, { sessionId: "peer-codex" }] } });
  });

  it("filters by agent kind and reaches every folder with --all", async () => {
    const { context } = makeContext({ sessions: () => sessions });
    await handleControlCommand(
      { ...TOKEN, callerSessionId: "caller", command: "broadcast", args: { text: "x", all: true, kind: "claude" } },
      context,
    );
    expect(vi.mocked(context.delivery.enqueue).mock.calls.map(([request]) => request.to)).toEqual(["peer-claude", "elsewhere"]);
  });

  it("refuses to guess a scope from outside a session", async () => {
    const { context } = makeContext({ sessions: () => sessions });
    const response = await handleControlCommand({ ...TOKEN, command: "broadcast", args: { text: "x" } }, context);
    expect(response).toMatchObject({ ok: false, error: expect.stringContaining("--all") });
  });
});

describe("board", () => {
  it("records every send on the board, and spawn's first prompt with a note", async () => {
    const { context } = makeContext();
    await handleControlCommand({ ...TOKEN, command: "send", args: { sessionId: "session-1", text: "x" } }, context);
    expect(context.board.recordDirect).toHaveBeenCalledWith(expect.objectContaining({ to: "session-1" }), undefined);
    await handleControlCommand({ ...TOKEN, command: "spawn", args: { projectId: "project-1", kind: "codex", prompt: "p" } }, context);
    expect(context.board.recordDirect).toHaveBeenLastCalledWith(expect.objectContaining({ to: "session-spawned" }), "첫 프롬프트");
  });

  it("never fails a send because the board could not be written", async () => {
    const { context } = makeContext();
    vi.mocked(context.board.recordDirect).mockRejectedValueOnce(new Error("disk full"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await handleControlCommand({ ...TOKEN, command: "send", args: { sessionId: "session-1", text: "x" } }, context)).toMatchObject({
      ok: true,
    });
    error.mockRestore();
  });

  it("posts to the caller's folder with comma-separated mentions", async () => {
    const { context } = makeContext();
    const response = await handleControlCommand(
      { ...TOKEN, callerSessionId: "session-1", command: "post", args: { text: "공지", to: "a, b" } },
      context,
    );
    expect(context.board.post).toHaveBeenCalledWith({ projectId: "project-1", text: "공지", mentions: ["a", "b"], from: "session-1" });
    expect(response).toMatchObject({ ok: true, result: { id: "post-1", projectId: "project-1", to: ["a", "b"] } });
  });

  it("reads the board, needing a folder from outside a session", async () => {
    const { context } = makeContext();
    vi.mocked(context.board.list).mockResolvedValueOnce([
      {
        id: "m1",
        projectId: "project-1",
        author: { kind: "session", sessionId: "s", name: "빌더", agent: "claude" },
        kind: "direct",
        text: "hi",
        to: [{ sessionId: "r", name: "리뷰어", agent: "codex", delivery: "held" }],
        createdAt: "2026-10-18T00:00:00.000Z",
      },
    ]);
    const response = await handleControlCommand(
      { ...TOKEN, callerSessionId: "session-1", command: "board", args: { limit: 500 } },
      context,
    );
    expect(context.board.list).toHaveBeenCalledWith("project-1", { sinceId: undefined, limit: 200 });
    expect(response).toMatchObject({
      ok: true,
      result: { messages: [{ id: "m1", from: { name: "빌더" }, to: [{ name: "리뷰어", delivery: "held" }], text: "hi" }] },
    });
    expect(await handleControlCommand({ ...TOKEN, command: "board" }, context)).toMatchObject({ ok: false, error: expect.stringContaining("--project") });
  });
});

describe("held", () => {
  it("lists held messages and drops one by id", async () => {
    const { context } = makeContext();
    vi.mocked(context.delivery.held).mockReturnValueOnce([record({ state: "held", reason: "working", text: "대기 중" })]);
    const listed = await handleControlCommand({ ...TOKEN, command: "held", args: { sessionId: "session-1" } }, context);
    expect(context.delivery.held).toHaveBeenCalledWith("session-1");
    expect(listed).toMatchObject({ ok: true, result: { messages: [{ id: "message-1", reason: "working", text: "대기 중" }] } });

    vi.mocked(context.delivery.drop).mockReturnValueOnce(record({ state: "dropped" }));
    expect(await handleControlCommand({ ...TOKEN, command: "held", args: { drop: "message-1" } }, context)).toMatchObject({
      ok: true,
      result: { dropped: { id: "message-1", outcome: "dropped" } },
    });
    expect(await handleControlCommand({ ...TOKEN, command: "held", args: { drop: "gone" } }, context)).toMatchObject({ ok: false });
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
    expect(context.delivery.enqueue).not.toHaveBeenCalled();
  });

  it("names the session and queues its first prompt without a sender prefix", async () => {
    const { context } = makeContext();

    const response = await handleControlCommand(
      {
        ...TOKEN,
        callerSessionId: "session-1",
        command: "spawn",
        args: { projectId: "project-1", kind: "codex", name: "  리뷰어\u0007 ", prompt: "diff를 검토해" },
      },
      context,
    );

    expect(context.create).toHaveBeenCalledWith(expect.objectContaining({ name: "리뷰어" }));
    expect(context.delivery.enqueue).toHaveBeenCalledWith({
      to: "session-spawned",
      text: "diff를 검토해",
      from: "session-1",
      raw: true,
    });
    expect(response).toMatchObject({ ok: true, result: { sessionId: "session-spawned", promptId: "message-1" } });
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
