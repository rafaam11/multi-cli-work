import type { RemoteSettings } from "../../shared/settings-types";
import type { RemoteAccessStatus, RemoteDeviceInfo, RemotePairingCode } from "../../shared/remote-types";
import type { RemoteDevice, RemoteDeviceStore } from "./device-store";
import type { PairingCodes } from "./pairing-codes";
import type { RemoteSessionHub } from "./remote-session-hub";
import { startRemoteServer, type PairOutcome, type RunningRemoteServer } from "./remote-server";

export interface RemoteAccessOptions {
  hub: Pick<RemoteSessionHub, "open" | "disconnectDevice" | "dispose">;
  devices: Pick<RemoteDeviceStore, "hostId" | "list" | "register" | "revoke">;
  pairing: Pick<PairingCodes, "issue" | "consume">;
  rendererDir: string;
  hostName: string;
  /** MULTI_CLI_WORK_REMOTE_BIND — e2e·개발용. 설정 화면에서는 바꿀 수 없다. */
  bindOverride: string | null;
  addresses(): string[];
  start?: typeof startRemoteServer;
  retryMs?: number;
}

const NO_TAILSCALE_MESSAGE =
  "Tailscale 주소(100.64.0.0/10)를 찾지 못했습니다. Tailscale이 켜지면 자동으로 다시 시도합니다.";

/**
 * 설정(remote.enabled·port)을 실제 서버 상태로 맞추는 곳. 적용은 한 번에 하나씩 순서대로 하고,
 * Tailscale이 아직 없으면 retryMs마다 다시 본다 — 부팅 때 Tailscale이 앱보다 늦게 뜨는 경우.
 */
export class RemoteAccess {
  private running: RunningRemoteServer | null = null;
  private current: RemoteAccessStatus = { state: "off", url: null, port: 0, message: null };
  private chain: Promise<RemoteAccessStatus> = Promise.resolve(this.current);
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSettings: RemoteSettings | null = null;

  constructor(private readonly options: RemoteAccessOptions) {}

  status(): RemoteAccessStatus {
    return this.current;
  }

  apply(settings: RemoteSettings): Promise<RemoteAccessStatus> {
    this.lastSettings = settings;
    this.chain = this.chain.catch(() => this.current).then(() => this.reconcile(settings));
    return this.chain;
  }

  issuePairingCode(): RemotePairingCode {
    if (this.current.state !== "listening" || this.current.url === null) {
      throw new Error("모바일 연결이 켜져 있지 않습니다");
    }
    const { code, expiresAt } = this.options.pairing.issue();
    return { code, expiresAt: new Date(expiresAt).toISOString(), url: this.current.url };
  }

  async pair(code: string, deviceName: string, clientIp: string): Promise<PairOutcome> {
    const result = this.options.pairing.consume(code, clientIp);
    if (result !== "ok") return { ok: false, reason: result };
    const { device, token } = await this.options.devices.register(deviceName);
    return {
      ok: true,
      response: { token, deviceId: device.deviceId, hostId: await this.options.devices.hostId(), hostName: this.options.hostName },
    };
  }

  async listDevices(): Promise<RemoteDeviceInfo[]> {
    return (await this.options.devices.list()).map(({ deviceId, name, createdAt, lastSeenAt }: RemoteDevice) => ({
      deviceId,
      name,
      createdAt,
      lastSeenAt,
    }));
  }

  async revokeDevice(deviceId: string): Promise<void> {
    await this.options.devices.revoke(deviceId);
    this.options.hub.disconnectDevice(deviceId);
  }

  async dispose(): Promise<void> {
    this.clearRetry();
    this.lastSettings = null;
    await this.chain.catch(() => undefined);
    this.options.hub.dispose();
    await this.running?.close();
    this.running = null;
  }

  private async reconcile(settings: RemoteSettings): Promise<RemoteAccessStatus> {
    this.clearRetry();
    const host = settings.enabled ? (this.options.bindOverride ?? this.options.addresses()[0] ?? null) : null;
    if (this.running && host === this.running.host && settings.port === this.running.port) return this.current;
    await this.running?.close();
    this.running = null;
    if (!settings.enabled) return this.set({ state: "off", url: null, port: settings.port, message: null });
    if (host === null) {
      this.scheduleRetry();
      return this.set({ state: "no-tailscale", url: null, port: settings.port, message: NO_TAILSCALE_MESSAGE });
    }
    try {
      this.running = await (this.options.start ?? startRemoteServer)({
        host,
        port: settings.port,
        rendererDir: this.options.rendererDir,
        hub: this.options.hub,
        pair: (code, deviceName, clientIp) => this.pair(code, deviceName, clientIp),
      });
      return this.set({ state: "listening", url: `http://${host}:${this.running.port}/mobile/`, port: settings.port, message: null });
    } catch (error) {
      return this.set({
        state: "error",
        url: null,
        port: settings.port,
        message: `서버를 열지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private set(status: RemoteAccessStatus): RemoteAccessStatus {
    this.current = status;
    return status;
  }

  private scheduleRetry(): void {
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.lastSettings?.enabled) void this.apply(this.lastSettings);
    }, this.options.retryMs ?? 30_000);
    this.retryTimer.unref?.();
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
