// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalSessionView } from "../../shared/api-types";
import type { TerminalEvent } from "../../shared/terminal-types";
import { REMOTE_CLOSE, REMOTE_PROTOCOL_VERSION, type RemoteServerMessage } from "../../shared/remote-types";
import { RemoteSessionHub } from "./remote-session-hub";
import { TerminalSizeArbiter } from "./size-arbiter";

const view = (id: string, overrides: Partial<TerminalSessionView> = {}): TerminalSessionView => ({
  id,
  projectId: "p1",
  tool: null,
  title: "제목",
  name: null,
  kind: "claude",
  cwd: "C:/work",
  providerConversationId: null,
  interruptedByShutdown: false,
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
  status: "working",
  pid: 1,
  exitCode: null,
  ...overrides,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const listeners = new Set<(event: TerminalEvent) => void>();
  let resolveAttach: ((value: { session: TerminalSessionView; replay: string; sequence: number }) => void) | null = null;
  const gateway = {
    list: vi.fn(() => [view("s1")]),
    attach: vi.fn(
      () =>
        new Promise<{ session: TerminalSessionView; replay: string; sequence: number }>((resolve) => {
          resolveAttach = resolve;
        }),
    ),
    write: vi.fn(async () => undefined),
    onEvent: (listener: (event: TerminalEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    projectName: vi.fn(async () => "Sample Project"),
    catalog: vi.fn(async () => ({
      projects: [{ id: "p1", name: "Sample Project" }],
      agents: [{ id: "claude", label: "Claude" }],
    })),
    create: vi.fn(async (input: { projectId: string; kind: string; cols: number; rows: number }) =>
      view("s-new", { kind: input.kind, status: "starting" }),
    ),
    resume: vi.fn(async (input: { sessionId: string; cols: number; rows: number }) =>
      view(input.sessionId, { status: "starting" }),
    ),
    stop: vi.fn(async (_sessionId: string) => undefined),
    remove: vi.fn(async (_sessionId: string) => undefined),
  };
  const devices = {
    verify: vi.fn(async (token: string) =>
      token === "good" ? { deviceId: "phone", name: "폰", tokenHash: "", createdAt: "", lastSeenAt: null } : null,
    ),
    touch: vi.fn(async () => undefined),
  };
  const resize = vi.fn(async () => undefined);
  const sizes = new TerminalSizeArbiter(resize);
  const hub = new RemoteSessionHub({ gateway, devices, sizes, hostId: async () => "host-1", hostName: "PC", helloTimeoutMs: 50, shellLatest: () => ({ versionCode: 2, versionName: "0.2.0", sha256: "c".repeat(64) }) });
  const sent: RemoteServerMessage[] = [];
  const close = vi.fn();
  const handle = hub.open({ send: (message) => sent.push(message), close });
  const emit = (event: TerminalEvent) => listeners.forEach((listener) => listener(event));
  const attachWith = (replay: string, sequence: number) => resolveAttach!({ session: view("s1"), replay, sequence });
  const hello = async (token = "good") => {
    handle.receive(JSON.stringify({ type: "hello", token, protocolVersion: REMOTE_PROTOCOL_VERSION, mode: "ui" }));
    await flush();
    await flush();
  };
  return { hub, handle, sent, close, emit, gateway, devices, sizes, resize, hello, attachWith };
}

afterEach(() => vi.useRealTimers());

describe("RemoteSessionHub", () => {
  it("welcomes a valid token and sends the session list", async () => {
    const { sent, hello, devices } = setup();
    await hello();
    expect(sent[0]).toEqual({
      type: "welcome",
      hostId: "host-1",
      hostName: "PC",
      deviceId: "phone",
      protocolVersion: 1,
      shellLatest: { versionCode: 2, versionName: "0.2.0", sha256: "c".repeat(64) },
    });
    expect(sent[1]).toEqual({
      type: "sessions",
      sessions: [
        {
          id: "s1",
          projectId: "p1",
          projectName: "Sample Project",
          kind: "claude",
          label: "제목",
          status: "working",
          updatedAt: "2026-09-30T00:00:00.000Z",
        },
      ],
    });
    expect(devices.touch).toHaveBeenCalledWith("phone");
  });

  it("closes with 4401 on a bad token or when the first message is not hello", async () => {
    const bad = setup();
    await bad.hello("bad");
    expect(bad.close).toHaveBeenCalledWith(REMOTE_CLOSE.unauthorized, expect.any(String));

    const early = setup();
    early.handle.receive('{"type":"list"}');
    await flush();
    expect(early.close).toHaveBeenCalledWith(REMOTE_CLOSE.unauthorized, expect.any(String));
  });

  it("closes with 4400 on a protocol version outside the range it speaks", async () => {
    for (const protocolVersion of [0, 99]) {
      const { handle, close } = setup();
      handle.receive(JSON.stringify({ type: "hello", token: "good", protocolVersion, mode: "ui" }));
      await flush();
      expect(close).toHaveBeenCalledWith(REMOTE_CLOSE.protocol, expect.any(String));
    }
  });

  it("closes a connection that never says hello", async () => {
    const { close } = setup();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(close).toHaveBeenCalledWith(REMOTE_CLOSE.retry, "hello timeout");
    expect(close).not.toHaveBeenCalledWith(REMOTE_CLOSE.unauthorized, expect.anything());
  });

  it("forwards data that arrives while attach is in flight, and only for attached sessions", async () => {
    const { handle, sent, emit, hello, attachWith } = setup();
    await hello();
    handle.receive('{"type":"attach","sessionId":"s1"}');
    await flush();
    emit({ type: "data", sessionId: "s1", data: "early", sequence: 6 });
    emit({ type: "data", sessionId: "other", data: "nope", sequence: 1 });
    attachWith("replay", 5);
    await flush();
    const types = sent.slice(2).map((message) => message.type);
    expect(types).toEqual(["data", "attached"]);
    expect(sent.at(-1)).toEqual({
      type: "attached",
      sessionId: "s1",
      replay: "replay",
      sequence: 5,
      cols: null,
      rows: null,
      sizeOwner: "desktop",
    });
  });

  it("attach alone never resizes the PTY", async () => {
    const { handle, hello, attachWith, resize } = setup();
    await hello();
    handle.receive('{"type":"attach","sessionId":"s1"}');
    await flush();
    attachWith("", 0);
    await flush();
    expect(resize).not.toHaveBeenCalled();
  });

  it("writes only to attached sessions", async () => {
    const { handle, sent, hello, attachWith, gateway } = setup();
    await hello();
    handle.receive('{"type":"write","sessionId":"s1","data":"x"}');
    await flush();
    expect(sent.at(-1)).toMatchObject({ type: "error", code: "not-attached" });
    handle.receive('{"type":"attach","sessionId":"s1"}');
    await flush();
    attachWith("", 0);
    await flush();
    handle.receive('{"type":"write","sessionId":"s1","data":"x"}');
    await flush();
    expect(gateway.write).toHaveBeenCalledWith("s1", "x");
  });

  it("broadcasts size changes to attached clients and releases the size on close", async () => {
    const { handle, sent, hello, attachWith, sizes } = setup();
    await hello();
    handle.receive('{"type":"attach","sessionId":"s1"}');
    await flush();
    attachWith("", 0);
    await flush();
    await sizes.desktopResize("s1", 120, 40);
    handle.receive('{"type":"resize","sessionId":"s1","cols":45,"rows":30}');
    await flush();
    expect(sent.at(-1)).toEqual({ type: "size", sessionId: "s1", cols: 45, rows: 30, sizeOwner: "phone" });
    handle.closed();
    await flush();
    expect(sizes.current("s1")).toEqual({ cols: 120, rows: 40, owner: "desktop" });
  });

  it("relays status, title, and exit to every authenticated client", async () => {
    const { sent, emit, hello } = setup();
    await hello();
    emit({ type: "status", sessionId: "s9", status: "awaiting-input" });
    emit({ type: "title", sessionId: "s9", title: "새 제목" });
    emit({ type: "exit", sessionId: "s9", exitCode: 0 });
    expect(sent.slice(-3)).toEqual([
      { type: "status", sessionId: "s9", status: "awaiting-input" },
      { type: "title", sessionId: "s9", title: "새 제목" },
      { type: "exit", sessionId: "s9", exitCode: 0 },
    ]);
  });

  it("disconnectDevice closes that device's connections with 4403", async () => {
    const { hub, close, hello } = setup();
    await hello();
    hub.disconnectDevice("phone");
    expect(close).toHaveBeenCalledWith(REMOTE_CLOSE.revoked, "revoked");
  });

  it("answers garbage with an error instead of throwing", async () => {
    const { handle, sent, hello } = setup();
    await hello();
    handle.receive("{{{");
    await flush();
    expect(sent.at(-1)).toMatchObject({ type: "error", code: "bad-message" });
  });

  it("a failing token check closes with a retryable code and no internal detail", async () => {
    const { handle, sent, close, devices } = setup();
    devices.verify.mockRejectedValueOnce(new Error("EBUSY: C:/Users/secret/remote-devices.json"));
    handle.receive(JSON.stringify({ type: "hello", token: "good", protocolVersion: REMOTE_PROTOCOL_VERSION, mode: "ui" }));
    await flush();
    await flush();
    expect(close).toHaveBeenCalledWith(REMOTE_CLOSE.retry, expect.any(String));
    expect(JSON.stringify(sent)).not.toContain("secret");
  });

  it("a revoked device cannot write even before its socket finishes closing", async () => {
    const { hub, handle, hello, attachWith, gateway } = setup();
    await hello();
    handle.receive('{"type":"attach","sessionId":"s1"}');
    await flush();
    attachWith("", 0);
    await flush();
    hub.disconnectDevice("phone");
    handle.receive('{"type":"write","sessionId":"s1","data":"rm -rf"}');
    await flush();
    expect(gateway.write).not.toHaveBeenCalled();
  });

  it("drops a client whose socket buffer is backed up instead of queueing without limit", async () => {
    const setupWith = setup();
    const { hub, emit } = setupWith;
    const sent: unknown[] = [];
    const close = vi.fn();
    const slow = hub.open({ send: (message) => sent.push(message), close, bufferedAmount: () => 5 * 1024 * 1024 });
    slow.receive(JSON.stringify({ type: "hello", token: "good", protocolVersion: REMOTE_PROTOCOL_VERSION, mode: "ui" }));
    await flush();
    await flush();
    slow.receive('{"type":"attach","sessionId":"s1"}');
    await flush();
    const before = sent.length;
    emit({ type: "data", sessionId: "s1", data: "flood", sequence: 1 });
    expect(close).toHaveBeenCalledWith(REMOTE_CLOSE.retry, "slow consumer");
    expect(sent.length).toBe(before);
  });
});

describe("RemoteSessionHub session management", () => {
  const finished = () => [view("s1", { status: "exited", pid: null, exitCode: 0 })];

  it("answers a catalog request", async () => {
    const { handle, sent, hello } = setup();
    await hello();
    handle.receive('{"type":"catalog"}');
    await flush();
    expect(sent.at(-1)).toEqual({
      type: "catalog",
      projects: [{ id: "p1", name: "Sample Project" }],
      agents: [{ id: "claude", label: "Claude" }],
    });
  });

  it("starts a session sized by the host and owned by the desktop, and tells only the requester", async () => {
    const { hub, handle, sent, hello, gateway, sizes, resize } = setup();
    await hello();
    const other: RemoteServerMessage[] = [];
    const second = hub.open({ send: (message) => other.push(message), close: vi.fn() });
    second.receive(JSON.stringify({ type: "hello", token: "good", protocolVersion: REMOTE_PROTOCOL_VERSION, mode: "ui" }));
    await flush();
    await flush();

    handle.receive('{"type":"create","projectId":"p1","kind":"codex"}');
    await flush();

    expect(gateway.create).toHaveBeenCalledWith({ projectId: "p1", kind: "codex", cols: 80, rows: 24 });
    expect(sent.at(-1)).toEqual({ type: "started", sessionId: "s-new" });
    expect(other.some((message) => message.type === "started")).toBe(false);
    // 만든 기기가 크기를 갖지 않는다 — 폰이 "폰 크기로"를 켠 적이 없는데 켜진 것처럼 보이면 안 된다.
    expect(sizes.current("s-new")).toEqual({ cols: 80, rows: 24, owner: "desktop" });
    expect(resize).not.toHaveBeenCalled();
  });

  it("starts a session at the size the requesting screen asked for, within bounds", async () => {
    const { handle, hello, gateway, sizes } = setup();
    await hello();

    handle.receive('{"type":"create","projectId":"p1","kind":"codex","cols":56,"rows":48}');
    await flush();
    expect(gateway.create).toHaveBeenLastCalledWith({ projectId: "p1", kind: "codex", cols: 56, rows: 48 });
    expect(sizes.current("s-new")).toEqual({ cols: 56, rows: 48, owner: "desktop" });

    handle.receive('{"type":"create","projectId":"p1","kind":"codex","cols":5,"rows":900}');
    await flush();
    expect(gateway.create).toHaveBeenLastCalledWith({ projectId: "p1", kind: "codex", cols: 20, rows: 200 });
  });

  it("stops a running session", async () => {
    const { handle, hello, gateway } = setup();
    await hello();
    handle.receive('{"type":"stop","sessionId":"s1"}');
    await flush();
    expect(gateway.stop).toHaveBeenCalledWith("s1");
  });

  it("refuses to restart a running session and to stop a finished one", async () => {
    const { handle, sent, hello, gateway } = setup();
    await hello();
    handle.receive('{"type":"resume","sessionId":"s1"}');
    await flush();
    expect(sent.at(-1)).toEqual({ type: "error", code: "failed", message: "이미 실행 중인 세션입니다" });
    expect(gateway.resume).not.toHaveBeenCalled();

    gateway.list.mockReturnValue(finished());
    handle.receive('{"type":"stop","sessionId":"s1"}');
    await flush();
    expect(sent.at(-1)).toEqual({ type: "error", code: "failed", message: "이미 끝난 세션입니다" });
    expect(gateway.stop).not.toHaveBeenCalled();

    handle.receive('{"type":"stop","sessionId":"gone"}');
    await flush();
    expect(sent.at(-1)).toEqual({ type: "error", code: "failed", message: "세션을 찾을 수 없습니다" });
  });

  it("restarts a finished session at its last size", async () => {
    const { handle, sent, hello, gateway, sizes } = setup();
    await hello();
    await sizes.desktopResize("s1", 120, 40);
    gateway.list.mockReturnValue(finished());
    handle.receive('{"type":"resume","sessionId":"s1"}');
    await flush();
    expect(gateway.resume).toHaveBeenCalledWith({ sessionId: "s1", cols: 120, rows: 40 });
    expect(sent.at(-1)).toEqual({ type: "started", sessionId: "s1" });
  });

  it("restarts a session nobody has sized yet at the default size", async () => {
    const { handle, hello, gateway, sizes } = setup();
    await hello();
    gateway.list.mockReturnValue(finished());
    handle.receive('{"type":"resume","sessionId":"s1"}');
    await flush();
    expect(gateway.resume).toHaveBeenCalledWith({ sessionId: "s1", cols: 80, rows: 24 });
    expect(sizes.current("s1")).toEqual({ cols: 80, rows: 24, owner: "desktop" });
  });

  it("says why a session could not be removed", async () => {
    const { handle, sent, hello, gateway } = setup();
    await hello();
    gateway.remove.mockRejectedValueOnce(new Error("진행 중인 PR 리뷰 세션은 '리뷰 완료' 흐름에서 정리하세요."));
    handle.receive('{"type":"remove","sessionId":"s1"}');
    await flush();
    expect(gateway.remove).toHaveBeenCalledWith("s1");
    expect(sent.at(-1)).toEqual({
      type: "error",
      code: "failed",
      message: "진행 중인 PR 리뷰 세션은 '리뷰 완료' 흐름에서 정리하세요.",
    });
  });

  it("broadcasts a removed session and stops forwarding it", async () => {
    const { handle, sent, emit, hello, attachWith } = setup();
    await hello();
    handle.receive('{"type":"attach","sessionId":"s1"}');
    await flush();
    attachWith("", 0);
    await flush();
    emit({ type: "removed", sessionId: "s1" });
    expect(sent.at(-1)).toEqual({ type: "removed", sessionId: "s1" });
    const before = sent.length;
    emit({ type: "data", sessionId: "s1", data: "late", sequence: 9 });
    expect(sent.length).toBe(before);
  });

  it("does not try to give a removed session's size back when its viewer leaves", async () => {
    const { handle, sent, emit, hello, attachWith, sizes, resize } = setup();
    await hello();
    await sizes.desktopResize("s1", 120, 40);
    handle.receive('{"type":"attach","sessionId":"s1"}');
    await flush();
    attachWith("", 0);
    await flush();
    handle.receive('{"type":"resize","sessionId":"s1","cols":50,"rows":20}');
    await flush();
    const resizes = resize.mock.calls.length;

    emit({ type: "removed", sessionId: "s1" });
    // 화면이 닫히며 보내는 detach. 지워진 세션을 호스트 크기로 되돌리려 하면 실패가 되어 돌아간다.
    handle.receive('{"type":"detach","sessionId":"s1"}');
    await flush();
    expect(resize.mock.calls.length).toBe(resizes);
    expect(sent.some((message) => message.type === "error")).toBe(false);
  });
});
