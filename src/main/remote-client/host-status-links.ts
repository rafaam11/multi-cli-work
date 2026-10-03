import type { HostPairing } from "./host-registry";
import type { HostStatusSnapshot } from "./host-status-link";

interface LinkLike {
  start(): void;
  close(): void;
  snapshot(): HostStatusSnapshot;
}

export interface HostStatusLinksOptions {
  createLink(host: HostPairing, hooks: { onChange(): void; onRejected(): void }): LinkLike;
  onChange(): void;
  onRejected(hostId: string): void;
}

const NO_LINK: HostStatusSnapshot = { link: "off", awaiting: 0 };

/** 같은 호스트라도 주소나 토큰이 바뀌면(다시 페어링) 다른 연결이다. */
function linkKey(host: HostPairing): string {
  return `${host.address}\n${host.deviceId}\n${host.token}`;
}

/**
 * 페어링된 호스트마다 상태 연결 하나. 호스트 목록이 바뀔 때마다 sync로 맞춘다 — 새 호스트는 붙이고,
 * 사라졌거나 다시 페어링된 것은 닫는다.
 */
export class HostStatusLinks {
  private readonly links = new Map<string, { key: string; link: LinkLike }>();

  constructor(private readonly options: HostStatusLinksOptions) {}

  sync(hosts: readonly HostPairing[]): void {
    const wanted = new Map(hosts.map((host) => [host.hostId, host]));
    for (const [hostId, entry] of [...this.links]) {
      const host = wanted.get(hostId);
      if (host && linkKey(host) === entry.key) continue;
      entry.link.close();
      this.links.delete(hostId);
    }
    for (const host of hosts) {
      if (this.links.has(host.hostId)) continue;
      const link = this.options.createLink(host, {
        onChange: () => this.options.onChange(),
        onRejected: () => {
          this.drop(host.hostId);
          this.options.onRejected(host.hostId);
        },
      });
      this.links.set(host.hostId, { key: linkKey(host), link });
      link.start();
    }
  }

  snapshot(hostId: string): HostStatusSnapshot {
    return this.links.get(hostId)?.link.snapshot() ?? NO_LINK;
  }

  closeAll(): void {
    for (const hostId of [...this.links.keys()]) this.drop(hostId);
  }

  private drop(hostId: string): void {
    const entry = this.links.get(hostId);
    if (!entry) return;
    entry.link.close();
    this.links.delete(hostId);
  }
}
