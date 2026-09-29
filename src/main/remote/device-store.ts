import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readJsonStore, updateJsonStore, type JsonStoreSpec } from "../storage/json-store";

export interface RemoteDevice {
  deviceId: string;
  name: string;
  /** sha256(token) hex. 토큰 원문은 어디에도 저장하지 않는다. */
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string | null;
}

interface RemoteDevicesFileV1 {
  version: 1;
  /** 이 호스트의 영구 ID. 폰이 여러 PC를 구분하는 열쇠다. 비어 있으면 아직 만들지 않았다. */
  hostId: string;
  devices: RemoteDevice[];
}

export interface DeviceStoreDeps {
  now(): string;
  randomId(): string;
  randomToken(): string;
}

const MAX_DEVICE_NAME_LENGTH = 40;
const DEFAULT_DEVICE_NAME = "이름 없는 기기";

class RemoteDeviceStoreError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDevice(value: unknown): value is RemoteDevice {
  return (
    isRecord(value) &&
    typeof value.deviceId === "string" &&
    typeof value.name === "string" &&
    typeof value.tokenHash === "string" &&
    /^[0-9a-f]{64}$/.test(value.tokenHash) &&
    typeof value.createdAt === "string" &&
    (value.lastSeenAt === null || typeof value.lastSeenAt === "string")
  );
}

function parseDevicesFile(value: unknown): RemoteDevicesFileV1 {
  const raw = isRecord(value) ? value : {};
  return {
    version: 1,
    hostId: typeof raw.hostId === "string" ? raw.hostId : "",
    devices: Array.isArray(raw.devices) ? raw.devices.filter(isDevice) : [],
  };
}

const spec: JsonStoreSpec<RemoteDevicesFileV1> = {
  label: "remote device store",
  displayName: "모바일 기기(remote-devices.json)",
  parse: parseDevicesFile,
  empty: () => parseDevicesFile(undefined),
  error: (message, options) => new RemoteDeviceStoreError(message, options),
  isContentError: (error) => error instanceof RemoteDeviceStoreError,
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function cleanName(name: string): string {
  const trimmed = name.trim().slice(0, MAX_DEVICE_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : DEFAULT_DEVICE_NAME;
}

export class RemoteDeviceStore {
  private readonly deps: DeviceStoreDeps;

  constructor(
    private readonly filePath: string,
    deps: Partial<DeviceStoreDeps> = {},
  ) {
    this.deps = {
      now: deps.now ?? (() => new Date().toISOString()),
      randomId: deps.randomId ?? (() => randomUUID()),
      randomToken: deps.randomToken ?? (() => randomBytes(32).toString("base64url")),
    };
  }

  async hostId(): Promise<string> {
    const current = (await readJsonStore(spec, this.filePath)).value.hostId;
    if (current) return current;
    const next = await updateJsonStore(spec, this.filePath, (file) =>
      file.hostId ? file : { ...file, hostId: this.deps.randomId() },
    );
    return next.hostId;
  }

  async list(): Promise<RemoteDevice[]> {
    return (await readJsonStore(spec, this.filePath)).value.devices;
  }

  async register(name: string): Promise<{ device: RemoteDevice; token: string }> {
    const token = this.deps.randomToken();
    const device: RemoteDevice = {
      deviceId: this.deps.randomId(),
      name: cleanName(name),
      tokenHash: hashToken(token),
      createdAt: this.deps.now(),
      lastSeenAt: null,
    };
    await updateJsonStore(spec, this.filePath, (file) => ({ ...file, devices: [...file.devices, device] }));
    return { device, token };
  }

  async verify(token: string): Promise<RemoteDevice | null> {
    if (token.length === 0) return null;
    const wanted = Buffer.from(hashToken(token), "hex");
    for (const device of await this.list()) {
      if (timingSafeEqual(wanted, Buffer.from(device.tokenHash, "hex"))) return device;
    }
    return null;
  }

  async touch(deviceId: string): Promise<void> {
    const now = this.deps.now();
    await updateJsonStore(spec, this.filePath, (file) => ({
      ...file,
      devices: file.devices.map((device) => (device.deviceId === deviceId ? { ...device, lastSeenAt: now } : device)),
    }));
  }

  async revoke(deviceId: string): Promise<boolean> {
    let removed = false;
    await updateJsonStore(spec, this.filePath, (file) => {
      const devices = file.devices.filter((device) => device.deviceId !== deviceId);
      removed = devices.length !== file.devices.length;
      return { ...file, devices };
    });
    return removed;
  }
}
