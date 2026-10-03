import {
  REMOTE_CLOSE,
  REMOTE_PROTOCOL_VERSION,
  type RemoteClientMessage,
  type RemoteServerMessage,
} from "./remote-types";

export type RemoteClientState = "connecting" | "open" | "reconnecting" | "unauthorized" | "incompatible";

/**
 * 브라우저의 WebSocket과 main의 `ws` 소켓에서 여기서 쓰는 부분. 이벤트 모양이 서로 달라서 느슨하게
 * 받고, 읽을 때 필요한 필드만 본다.
 */
export interface RemoteSocketLike {
  onopen: ((event: any) => void) | null;
  onmessage: ((event: any) => void) | null;
  onclose: ((event: any) => void) | null;
  send(data: string): void;
  close(code?: number): void;
}

export interface RemoteClientOptions {
  url: string;
  token: string;
  createSocket?: (url: string) => RemoteSocketLike;
  delaysMs?: readonly number[];
  /** hello에 실어 보내는 버전. 웹 UI는 자기 빌드의 버전을, 상태 연결은 고정된 낮은 버전을 보낸다. */
  protocolVersion?: number;
}

const DEFAULT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

/**
 * 호스트 하나와의 WS 연결. 끊기면 백오프로 다시 붙는다. 다시 붙어도 소용없는 두 경우에는 멈춘다:
 * 4401·4403(등록 안 됨·철회 — 다시 페어링해야 한다)과 4400(버전이 맞지 않는다). 재연결 뒤의
 * attach는 각 화면이 onState("open")를 보고 다시 보낸다.
 *
 * 호스트가 서빙한 웹 UI와, 다른 PC의 main이 유지하는 상태 연결이 같이 쓴다.
 */
export class RemoteClient {
  private socket: RemoteSocketLike | null = null;
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
        JSON.stringify({
          type: "hello",
          token: this.options.token,
          protocolVersion: this.options.protocolVersion ?? REMOTE_PROTOCOL_VERSION,
          mode: "ui",
        }),
      );
    };
    socket.onmessage = (event: { data: unknown }) => {
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
    socket.onclose = (event: { code?: number }) => {
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      if (event.code === REMOTE_CLOSE.unauthorized || event.code === REMOTE_CLOSE.revoked) {
        this.stopped = true;
        this.setState("unauthorized");
        return;
      }
      if (event.code === REMOTE_CLOSE.protocol) {
        this.stopped = true;
        this.setState("incompatible");
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
