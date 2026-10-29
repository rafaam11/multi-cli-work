// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { observeHost } from "./host-observer";
import type { HostClient } from "../host/host-client";
afterEach(() => vi.useRealTimers());
it("keeps last observations on loss, refreshes the endpoint, and ignores late events from old sockets", async () => {
  vi.useFakeTimers();
  const listeners: ((event: unknown) => void)[] = [], closed = vi.fn(), state = vi.fn(), refresh = vi.fn(async () => {});
  const client = { watch: vi.fn((listener: (event: unknown) => void) => { listeners.push(listener); return { close: closed }; }) } as unknown as HostClient;
  const observer = observeHost({ client, refresh, state });
  const snapshot = { type: "state", tasks: [], terminals: [{ id: "s", connected: true, observedAt: 400 }], observedAt: 500 };
  listeners[0](snapshot); listeners[0]({ type: "disconnected", observedAt: 999 });
  expect(state).toHaveBeenLastCalledWith({ ...snapshot, connected: false, terminals: [{ id: "s", connected: false, observedAt: 400 }] });
  await vi.advanceTimersByTimeAsync(1000);
  expect(refresh).toHaveBeenCalledOnce(); expect(listeners).toHaveLength(2);
  listeners[1]({ ...snapshot, observedAt: 1000 });
  listeners[0]({ ...snapshot, observedAt: 600 });
  expect(state).toHaveBeenLastCalledWith({ ...snapshot, observedAt: 1000, connected: true });
  observer.close(); await vi.advanceTimersByTimeAsync(5000);
  expect(listeners).toHaveLength(2);
});
it("never reconnects after disposal while endpoint refresh is pending", async () => {
  vi.useFakeTimers();
  let listener!: (event: unknown) => void, finish!: () => void;
  const client = { watch: vi.fn((callback: (event: unknown) => void) => { listener = callback; return { close: vi.fn() }; }) } as unknown as HostClient;
  const observer = observeHost({ client, state: vi.fn(), refresh: () => new Promise<void>(resolve => { finish = resolve; }) });
  listener({ type: "disconnected" }); await vi.advanceTimersByTimeAsync(1000); observer.close(); finish();
  await vi.advanceTimersByTimeAsync(5000); expect(client.watch).toHaveBeenCalledOnce();
});
