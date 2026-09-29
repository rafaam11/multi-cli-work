import {
  REMOTE_CLOSE,
  REMOTE_PROTOCOL_VERSION,
  type RemoteClientMessage,
  type RemotePairResponse,
  type RemoteServerMessage,
} from "@shared/remote-types";

export type RemoteClientState = "connecting" | "open" | "reconnecting" | "unauthorized";

export interface RemoteClientOptions {
  url: string;
  token: string;
  createSocket?: (url: string) => WebSocket;
  delaysMs?: readonly number[];
}

const DEFAULT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

/**
 * 호스트 하나와의 WS 연결. 끊기면 백오프로 다시 붙고, 4401·4403(등록 안 됨·철회)이면 멈춰서
 * 다시 페어링하게 한다. 재연결 뒤의 attach는 각 화면이 onState("open")를 보고 다시 보낸다.
 */
export class RemoteClient {
  private socket: WebSocket | null = null;
  private attempt = 0;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private current: RemoteClientState = "connecting";
  private readonly messageListeners = new Set<(message: RemoteServerMessage) => void>();
  private readonly stateListeners = new Set<(state: RemoteClientState) => void>();

  constructor(private readonly options: RemoteClientOptions) {}

  state(): RemoteClientState {
    return this.current;
  }

  onMessage(listener: (message: RemoteServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onState(listener: (state: RemoteClientState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  connect(): void {
    if (this.stopped) return;
    const socket = (this.options.createSocket ?? ((url) => new WebSocket(url)))(this.options.url);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(
        JSON.stringify({ type: "hello", token: this.options.token, protocolVersion: REMOTE_PROTOCOL_VERSION, mode: "ui" }),
      );
    };
    socket.onmessage = (event: MessageEvent) => {
      let message: RemoteServerMessage;
      try {
        message = JSON.parse(String(event.data)) as RemoteServerMessage;
      } catch {
        return;
      }
      if (message.type === "welcome") {
        this.attempt = 0;
        this.setState("open");
      }
      for (const listener of this.messageListeners) listener(message);
    };
    socket.onclose = (event: CloseEvent) => {
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      if (event.code === REMOTE_CLOSE.unauthorized || event.code === REMOTE_CLOSE.revoked) {
        this.stopped = true;
        this.setState("unauthorized");
        return;
      }
      this.setState("reconnecting");
      const delays = this.options.delaysMs ?? DEFAULT_DELAYS_MS;
      const delay = delays[Math.min(this.attempt, delays.length - 1)]!;
      this.attempt += 1;
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  send(message: RemoteClientMessage): boolean {
    if (this.current !== "open" || this.socket === null) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }

  close(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close(1000);
    this.socket = null;
  }

  private setState(state: RemoteClientState): void {
    if (this.current === state) return;
    this.current = state;
    for (const listener of this.stateListeners) listener(state);
  }
}

export function remoteSocketUrl(location: Pick<Location, "protocol" | "host">): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
}

export interface StoredPairing {
  token: string;
  deviceId: string;
  hostName: string;
}

const PAIRING_KEY = "mcw.remote.pairing";

export function loadPairing(storage: Storage | null): StoredPairing | null {
  try {
    const raw = storage?.getItem(PAIRING_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredPairing>;
    return typeof value.token === "string" && typeof value.deviceId === "string" && typeof value.hostName === "string"
      ? { token: value.token, deviceId: value.deviceId, hostName: value.hostName }
      : null;
  } catch {
    return null;
  }
}

export function savePairing(storage: Storage | null, pairing: StoredPairing): void {
  try {
    storage?.setItem(PAIRING_KEY, JSON.stringify(pairing));
  } catch {
    // 저장이 막힌 브라우저에서는 이번 방문 동안만 쓴다.
  }
}

export function clearPairing(storage: Storage | null): void {
  try {
    storage?.removeItem(PAIRING_KEY);
  } catch {
    // 위와 같다.
  }
}

export async function requestPairing(code: string, deviceName: string, fetchImpl: typeof fetch = fetch): Promise<StoredPairing> {
  const response = await fetchImpl("/pair", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, deviceName }),
  });
  if (response.status === 401) throw new Error("코드가 맞지 않거나 만료되었습니다");
  if (response.status === 429) throw new Error("시도가 너무 많습니다. 잠시 후 다시 시도하세요");
  if (!response.ok) throw new Error(`페어링에 실패했습니다 (${response.status})`);
  const body = (await response.json()) as RemotePairResponse;
  return { token: body.token, deviceId: body.deviceId, hostName: body.hostName };
}
