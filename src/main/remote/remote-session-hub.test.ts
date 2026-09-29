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
  };
  const devices = {
    verify: vi.fn(async (token: string) =>
      token === "good" ? { deviceId: "phone", name: "폰", tokenHash: "", createdAt: "", lastSeenAt: null } : null,
    ),
    touch: vi.fn(async () => undefined),
  };
  const resize = vi.fn(async () => undefined);
  const sizes = new TerminalSizeArbiter(resize);
  const hub = new RemoteSessionHub({ gateway, devices, sizes, hostId: async () => "host-1", hostName: "PC", helloTimeoutMs: 50 });
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
    expect(sent[0]).toEqual({ type: "welcome", hostId: "host-1", hostName: "PC", deviceId: "phone", protocolVersion: 1 });
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

  it("closes with 4400 on a protocol version mismatch", async () => {
    const { handle, close } = setup();
    handle.receive(JSON.stringify({ type: "hello", token: "good", protocolVersion: 99, mode: "ui" }));
    await flush();
    expect(close).toHaveBeenCalledWith(REMOTE_CLOSE.protocol, expect.any(String));
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
