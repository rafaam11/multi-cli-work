import type { RemoteHostInfo } from "../../shared/remote-types";
import type { SafeStorageLike } from "../notion/notion-token-store";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../storage/json-store";

interface StoredHost {
  hostId: string;
  name: string;
  /** "100.x.y.z:47821" */
  address: string;
  deviceId: string;
  /** safeStorage 암호문의 base64. 호스트가 이 기기를 거절했으면 null. */
  token: string | null;
  notify: boolean;
  addedAt: string;
}

interface RemoteHostsFileV1 {
  version: 1;
  hosts: StoredHost[];
}

export interface NewRemoteHost {
  hostId: string;
  name: string;
  address: string;
  deviceId: string;
  /** 호스트가 발급한 기기 토큰 원문. */
  token: string;
}

/** 원격 창과 상태 연결이 호스트에 붙을 때 쓰는 것. main 안에서만 돈다. */
export interface HostPairing {
  hostId: string;
  hostName: string;
  address: string;
  deviceId: string;
  token: string;
}

class RemoteHostRegistryError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredHost(value: unknown): value is StoredHost {
  return (
    isRecord(value) &&
    typeof value.hostId === "string" &&
    typeof value.name === "string" &&
    typeof value.address === "string" &&
    typeof value.deviceId === "string" &&
    (value.token === null || typeof value.token === "string") &&
    typeof value.notify === "boolean" &&
    typeof value.addedAt === "string"
  );
}

function parseHostsFile(value: unknown): RemoteHostsFileV1 {
  const raw = isRecord(value) ? value : {};
  return { version: 1, hosts: Array.isArray(raw.hosts) ? raw.hosts.filter(isStoredHost) : [] };
}

const spec: JsonStoreSpec<RemoteHostsFileV1> = {
  label: "remote host registry",
  displayName: "원격 PC 목록(remote-hosts.json)",
  parse: parseHostsFile,
  empty: () => parseHostsFile(undefined),
  error: (message, options) => new RemoteHostRegistryError(message, options),
  isContentError: (error) => error instanceof RemoteHostRegistryError,
};

function toInfo(host: StoredHost): RemoteHostInfo {
  return {
    hostId: host.hostId,
    name: host.name,
    address: host.address,
    notify: host.notify,
    paired: host.token !== null,
    addedAt: host.addedAt,
  };
}

/**
 * 이 PC가 클라이언트로서 등록해 둔 다른 PC들. 기기 토큰은 시크릿이라 safeStorage로 암호화해 두고,
 * 렌더러에는 토큰이 없는 RemoteHostInfo만 내보낸다. 원문은 pairing()으로 main 안에서만 꺼낸다.
 */
export class RemoteHostRegistry {
  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageLike,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  canStore(): boolean {
    return this.safeStorage.isEncryptionAvailable();
  }

  async list(): Promise<RemoteHostInfo[]> {
    return (await readJsonStore(spec, this.filePath)).value.hosts.map(toInfo);
  }

  /** 같은 hostId가 이미 있으면 그 자리에서 새 토큰·주소로 바꾼다. */
  async save(input: NewRemoteHost): Promise<RemoteHostInfo> {
    if (!this.canStore()) throw new Error("이 환경에서는 토큰을 안전하게 저장할 수 없습니다");
    const token = this.safeStorage.encryptString(input.token).toString("base64");
    const file = await updateJsonStore(spec, this.filePath, (current) => {
      const existing = current.hosts.find((host) => host.hostId === input.hostId);
      const next: StoredHost = {
        hostId: input.hostId,
        name: input.name,
        address: input.address,
        deviceId: input.deviceId,
        token,
        notify: existing?.notify ?? true,
        addedAt: existing?.addedAt ?? this.now(),
      };
      return {
        ...current,
        hosts: existing
          ? current.hosts.map((host) => (host.hostId === input.hostId ? next : host))
          : [...current.hosts, next],
      };
    });
    return toInfo(file.hosts.find((host) => host.hostId === input.hostId)!);
  }

  async remove(hostId: string): Promise<void> {
    await updateJsonStore(spec, this.filePath, (current) => ({
      ...current,
      hosts: current.hosts.filter((host) => host.hostId !== hostId),
    }));
  }

  async setNotify(hostId: string, notify: boolean): Promise<void> {
    await this.patch(hostId, { notify });
  }

  /** 호스트가 이 기기를 거절했다. 항목은 남겨 "다시 페어링 필요"로 보이게 한다. */
  async clearToken(hostId: string): Promise<void> {
    await this.patch(hostId, { token: null });
  }

  async pairing(hostId: string): Promise<HostPairing | null> {
    const host = (await readJsonStore(spec, this.filePath)).value.hosts.find((candidate) => candidate.hostId === hostId);
    if (!host || host.token === null) return null;
    try {
      return {
        hostId: host.hostId,
        hostName: host.name,
        address: host.address,
        deviceId: host.deviceId,
        token: this.safeStorage.decryptString(Buffer.from(host.token, "base64")),
      };
    } catch {
      // 다른 OS 계정이 쓴 암호문은 풀리지 않는다 — 페어링이 없는 것과 같이 다룬다.
      return null;
    }
  }

  private async patch(hostId: string, change: Partial<StoredHost>): Promise<void> {
    await updateJsonStore(spec, this.filePath, (current) => ({
      ...current,
      hosts: current.hosts.map((host) => (host.hostId === hostId ? { ...host, ...change } : host)),
    }));
  }
}
