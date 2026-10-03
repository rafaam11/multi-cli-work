// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { RemoteHostLink } from "../../shared/remote-types";
import type { HostPairing } from "./host-registry";
import { HostStatusLinks } from "./host-status-links";

const host = (hostId: string, overrides: Partial<HostPairing> = {}): HostPairing => ({
  hostId,
  hostName: hostId,
  address: "100.64.0.9:47821",
  deviceId: "dev",
  token: `tok-${hostId}`,
  ...overrides,
});

function setup() {
  const created: Array<{
    host: HostPairing;
    hooks: { onChange(): void; onRejected(): void };
    start: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    state: { link: RemoteHostLink; awaiting: number };
  }> = [];
  const onChange = vi.fn();
  const onRejected = vi.fn();
  const links = new HostStatusLinks({
    createLink: (pairing, hooks) => {
      const entry = { host: pairing, hooks, start: vi.fn(), close: vi.fn(), state: { link: "open" as RemoteHostLink, awaiting: 2 } };
      created.push(entry);
      return { start: entry.start, close: entry.close, snapshot: () => entry.state };
    },
    onChange,
    onRejected,
  });
  return { links, created, onChange, onRejected };
}

describe("HostStatusLinks", () => {
  it("links every paired host and drops the ones that went away", () => {
    const { links, created } = setup();
    links.sync([host("a"), host("b")]);
    expect(created.map((entry) => entry.host.hostId)).toEqual(["a", "b"]);
    expect(created.every((entry) => entry.start.mock.calls.length === 1)).toBe(true);
    // 같은 목록으로 다시 맞춰도 새로 붙지 않는다.
    links.sync([host("a"), host("b")]);
    expect(created).toHaveLength(2);

    links.sync([host("b")]);
    expect(created[0]!.close).toHaveBeenCalledOnce();
    expect(created[1]!.close).not.toHaveBeenCalled();
    expect(links.snapshot("a")).toEqual({ link: "off", awaiting: 0 });
    expect(links.snapshot("b")).toEqual({ link: "open", awaiting: 2 });
  });

  it("replaces a link whose address or token changed", () => {
    const { links, created } = setup();
    links.sync([host("a")]);
    links.sync([host("a", { token: "tok-new" })]);
    expect(created[0]!.close).toHaveBeenCalledOnce();
    expect(created).toHaveLength(2);
    expect(created[1]!.host.token).toBe("tok-new");
    links.sync([host("a", { token: "tok-new", address: "100.64.0.10:47821" })]);
    expect(created).toHaveLength(3);
  });

  it("passes changes on and drops a link the host rejected", () => {
    const { links, created, onChange, onRejected } = setup();
    links.sync([host("a")]);
    created[0]!.hooks.onChange();
    expect(onChange).toHaveBeenCalledOnce();
    created[0]!.hooks.onRejected();
    expect(created[0]!.close).toHaveBeenCalledOnce();
    expect(onRejected).toHaveBeenCalledWith("a");
    expect(links.snapshot("a")).toEqual({ link: "off", awaiting: 0 });
  });

  it("closes everything on shutdown", () => {
    const { links, created } = setup();
    links.sync([host("a"), host("b")]);
    links.closeAll();
    expect(created.every((entry) => entry.close.mock.calls.length === 1)).toBe(true);
    expect(links.snapshot("a")).toEqual({ link: "off", awaiting: 0 });
  });
});
