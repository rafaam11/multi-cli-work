import { afterEach, describe, expect, it, vi } from "vitest";
import { REMOTE_CLOSE } from "@shared/remote-types";
import { clearPairing, loadPairing, RemoteClient, remoteSocketUrl, requestPairing, savePairing } from "./remote-client";

class FakeSocket {
  static instances: FakeSocket[] = [];
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.onclose?.({ code: 1000 });
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function client() {
  FakeSocket.instances = [];
  const remote = new RemoteClient({
    url: "ws://h/ws",
    token: "tok",
    createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
    delaysMs: [10],
  });
  const states: string[] = [];
  remote.onState((state) => states.push(state));
  return { remote, states };
}

const welcome = { type: "welcome", hostId: "h", hostName: "PC", deviceId: "d", protocolVersion: 1 };

afterEach(() => vi.useRealTimers());

describe("RemoteClient", () => {
  it("says hello on open and becomes open on welcome", () => {
    const { remote, states } = client();
    remote.connect();
    const socket = FakeSocket.instances[0]!;
    socket.onopen?.();
    expect(JSON.parse(socket.sent[0]!)).toEqual({ type: "hello", token: "tok", protocolVersion: 1, mode: "ui" });
    expect(remote.send({ type: "list" })).toBe(false);
    socket.receive(welcome);
    expect(states).toEqual(["open"]);
    expect(remote.send({ type: "list" })).toBe(true);
  });

  it("reconnects after an unexpected close", async () => {
    vi.useFakeTimers();
    const { remote, states } = client();
    remote.connect();
    FakeSocket.instances[0]!.onclose?.({ code: 1006 });
    expect(states).toEqual(["reconnecting"]);
    await vi.advanceTimersByTimeAsync(10);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("stops reconnecting on 4401 and 4403", async () => {
    vi.useFakeTimers();
    for (const code of [REMOTE_CLOSE.unauthorized, REMOTE_CLOSE.revoked]) {
      const { remote, states } = client();
      remote.connect();
      FakeSocket.instances[0]!.onclose?.({ code });
      await vi.advanceTimersByTimeAsync(50);
      expect(states).toEqual(["unauthorized"]);
      expect(FakeSocket.instances).toHaveLength(1);
    }
  });

  it("does not reconnect after close()", async () => {
    vi.useFakeTimers();
    const { remote } = client();
    remote.connect();
    remote.close();
    await vi.advanceTimersByTimeAsync(50);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("delivers server messages to listeners", () => {
    const { remote } = client();
    const received: unknown[] = [];
    remote.onMessage((message) => received.push(message));
    remote.connect();
    FakeSocket.instances[0]!.receive({ type: "sessions", sessions: [] });
    expect(received).toEqual([{ type: "sessions", sessions: [] }]);
  });
});

describe("remoteSocketUrl", () => {
  it("follows the page's host and scheme", () => {
    expect(remoteSocketUrl({ protocol: "http:", host: "100.64.0.9:47821" })).toBe("ws://100.64.0.9:47821/ws");
    expect(remoteSocketUrl({ protocol: "https:", host: "pc.ts.net" })).toBe("wss://pc.ts.net/ws");
  });
});

describe("pairing storage", () => {
  it("round-trips and tolerates garbage or a missing storage", () => {
    const pairing = { token: "t", deviceId: "d", hostName: "PC" };
    savePairing(window.localStorage, pairing);
    expect(loadPairing(window.localStorage)).toEqual(pairing);
    window.localStorage.setItem("mcw.remote.pairing", "{bad");
    expect(loadPairing(window.localStorage)).toBeNull();
    clearPairing(window.localStorage);
    expect(loadPairing(null)).toBeNull();
  });
});

describe("requestPairing", () => {
  it("maps HTTP errors to Korean messages", async () => {
    const respond = (status: number, body: unknown = {}) =>
      vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    await expect(requestPairing("x", "폰", respond(401))).rejects.toThrow("코드가 맞지 않거나 만료되었습니다");
    await expect(requestPairing("x", "폰", respond(429))).rejects.toThrow("시도가 너무 많습니다");
    await expect(
      requestPairing("x", "폰", respond(200, { token: "t", deviceId: "d", hostId: "h", hostName: "PC" })),
    ).resolves.toEqual({ token: "t", deviceId: "d", hostName: "PC" });
  });
});
