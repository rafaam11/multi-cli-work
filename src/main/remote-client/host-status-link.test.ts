// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";
import { REMOTE_CLOSE, type RemoteSessionSummary } from "../../shared/remote-types";
import type { NotifiableStatus } from "../../shared/settings-types";
import type { HostPairing } from "./host-registry";
import { HostStatusLink, type HostStatusNotice } from "./host-status-link";

class FakeSocket {
  sent: Array<{ type: string; [key: string]: unknown }> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  constructor(public url: string) {}
  send(data: string): void {
    this.sent.push(JSON.parse(data) as { type: string });
  }
  close(): void {}
  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const HOST: HostPairing = { hostId: "host-1", hostName: "회사PC", address: "100.64.0.9:47821", deviceId: "dev-1", token: "tok" };

const session = (id: string, status: RemoteSessionSummary["status"], label = id): RemoteSessionSummary => ({
  id,
  projectId: "p",
  projectName: "A",
  kind: "claude",
  label,
  status,
  updatedAt: "",
});

function setup() {
  const sockets: FakeSocket[] = [];
  let allowed = true;
  const notices: HostStatusNotice[] = [];
  const asked: NotifiableStatus[] = [];
  const onChange = vi.fn();
  const onRejected = vi.fn();
  const link = new HostStatusLink({
    host: HOST,
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    delaysMs: [10],
    shouldNotify: (status) => {
      asked.push(status);
      return allowed;
    },
    notify: (notice) => notices.push(notice),
    onChange,
    onRejected,
  });
  link.start();
  const connect = (sessions: RemoteSessionSummary[] = []) => {
    const socket = sockets.at(-1)!;
    socket.onopen?.();
    socket.receive({ type: "welcome", hostId: "host-1", hostName: "회사PC", deviceId: "dev-1", protocolVersion: 1, shellLatest: null });
    socket.receive({ type: "sessions", sessions });
    return socket;
  };
  return { link, sockets, notices, asked, onChange, onRejected, connect, allow: (value: boolean) => (allowed = value) };
}

afterEach(() => vi.useRealTimers());

describe("HostStatusLink", () => {
  it("says hello and never attaches", () => {
    const { sockets, connect } = setup();
    expect(sockets[0]!.url).toBe("ws://100.64.0.9:47821/ws");
    const socket = connect([session("s1", "working")]);
    socket.receive({ type: "status", sessionId: "s1", status: "awaiting-input" });
    expect(socket.sent).toEqual([{ type: "hello", token: "tok", protocolVersion: 1, mode: "ui" }]);
  });

  it("counts waiting sessions and reports changes", () => {
    const { link, onChange, connect } = setup();
    expect(link.snapshot()).toEqual({ link: "connecting", awaiting: 0 });
    const socket = connect([session("s1", "awaiting-input"), session("s2", "working"), session("s3", "awaiting-approval")]);
    expect(link.snapshot()).toEqual({ link: "open", awaiting: 2 });
    const calls = onChange.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    // 바뀐 것이 없으면 알리지 않는다.
    socket.receive({ type: "title", sessionId: "s2", title: "새 제목" });
    expect(onChange).toHaveBeenCalledTimes(calls);
    socket.receive({ type: "status", sessionId: "s1", status: "working" });
    expect(link.snapshot()).toEqual({ link: "open", awaiting: 1 });
    expect(onChange).toHaveBeenCalledTimes(calls + 1);
  });

  it("does not notify for sessions already waiting when it connects", () => {
    const { notices, asked, connect } = setup();
    connect([session("s1", "awaiting-input"), session("s2", "awaiting-approval")]);
    expect(notices).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("notifies once per wait, and again after the session moved on", () => {
    const { notices, connect } = setup();
    const socket = connect([session("s1", "working", "리팩터")]);
    socket.receive({ type: "status", sessionId: "s1", status: "awaiting-input" });
    expect(notices).toEqual([
      { hostId: "host-1", hostName: "회사PC", sessionId: "s1", label: "리팩터", status: "awaiting-input" },
    ]);
    // 같은 대기가 다시 와도 한 번이다.
    socket.receive({ type: "status", sessionId: "s1", status: "awaiting-input" });
    expect(notices).toHaveLength(1);
    // 대기가 풀렸다가 다시 걸리면 새 알림이다.
    socket.receive({ type: "status", sessionId: "s1", status: "working" });
    socket.receive({ type: "status", sessionId: "s1", status: "awaiting-input" });
    expect(notices).toHaveLength(2);
    socket.receive({ type: "status", sessionId: "s1", status: "exited" });
    expect(notices.at(-1)).toMatchObject({ status: "exited" });
  });

  it("stays quiet while the host's window is focused, without counting the skipped notice as sent", () => {
    const { notices, connect, allow } = setup();
    const socket = connect([session("s1", "working")]);
    allow(false);
    socket.receive({ type: "status", sessionId: "s1", status: "awaiting-input" });
    expect(notices).toEqual([]);
    // 건너뛴 것은 알린 것으로 치지 않는다. 다만 호스트는 같은 상태를 다시 보내지 않으므로, 실제로는
    // 보고 있는 동안 생긴 대기는 나중에도 알림이 오지 않는다(대기 수로만 보인다) — 아래는 기록 규칙만 본다.
    allow(true);
    socket.receive({ type: "status", sessionId: "s1", status: "awaiting-input" });
    expect(notices).toHaveLength(1);
  });

  it("stops and reports a rejected token", async () => {
    vi.useFakeTimers();
    const { link, sockets, onRejected, connect } = setup();
    const socket = connect([session("s1", "awaiting-input")]);
    socket.onclose?.({ code: REMOTE_CLOSE.revoked });
    await vi.advanceTimersByTimeAsync(100);
    expect(onRejected).toHaveBeenCalledOnce();
    expect(sockets).toHaveLength(1);
    expect(link.snapshot()).toEqual({ link: "off", awaiting: 0 });
  });

  it("keeps retrying a host that is offline without notifying", async () => {
    vi.useFakeTimers();
    const { link, sockets, notices, onRejected } = setup();
    sockets[0]!.onclose?.({ code: 1006 });
    expect(link.snapshot()).toEqual({ link: "reconnecting", awaiting: 0 });
    await vi.advanceTimersByTimeAsync(10);
    expect(sockets).toHaveLength(2);
    expect(notices).toEqual([]);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it("forgets what it knew while the connection is down", () => {
    const { link, connect } = setup();
    const socket = connect([session("s1", "awaiting-input")]);
    expect(link.snapshot().awaiting).toBe(1);
    socket.onclose?.({ code: 1006 });
    expect(link.snapshot()).toEqual({ link: "reconnecting", awaiting: 0 });
  });

  it("does not retry an incompatible host", async () => {
    vi.useFakeTimers();
    const { link, sockets } = setup();
    sockets[0]!.onclose?.({ code: REMOTE_CLOSE.protocol });
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(1);
    expect(link.snapshot()).toEqual({ link: "incompatible", awaiting: 0 });
  });

  it("opens nothing more once closed", async () => {
    vi.useFakeTimers();
    const { link, sockets } = setup();
    link.close();
    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(1);
  });
});
