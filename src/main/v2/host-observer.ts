import type { V2HostState } from "../../shared/v2-api";
import type { HostClient, HostTerminalSocket } from "../host/host-client";

/** Reconnect only the observation transport. Commands and work are never replayed here. */
export function observeHost(options: { client: HostClient; refresh?(): Promise<void>; state(value: V2HostState): void }) {
  let closed = false, epoch = 0, socket: HostTerminalSocket | undefined, retry: ReturnType<typeof setTimeout> | undefined;
  let latest: V2HostState = { tasks: [], terminals: [], observedAt: null, connected: false };
  const schedule = () => {
    if (closed || retry) return;
    retry = setTimeout(async () => {
      retry = undefined;
      try { await options.refresh?.(); if (!closed) connect(); }
      catch { schedule(); }
    }, 1000);
  };
  const connect = () => {
    const current = ++epoch;
    socket = options.client.watch(event => {
      if (closed || current !== epoch || !event || typeof event !== "object") return;
      const value = event as {type?: string} & V2HostState;
      if (value.type === "state" && Array.isArray(value.tasks) && Array.isArray(value.terminals) && Number.isFinite(value.observedAt)) {
        latest = { ...value, connected: true }; options.state(latest);
      } else if (value.type === "disconnected") {
        epoch++; socket?.close();
        // A disconnection is not a new observation of any process or task.
        latest = { ...latest, connected: false, terminals: latest.terminals.map(terminal => ({ ...terminal, connected: false })),
          ...(latest.hosts?{hosts:latest.hosts.map(host=>({...host,connected:false,terminals:host.terminals.map(terminal=>({...terminal,connected:false}))}))}:{}) };
        options.state(latest); schedule();
      }
    });
  };
  connect();
  return { snapshot: () => latest, close() { closed = true; epoch++; clearTimeout(retry); socket?.close(); } };
}
