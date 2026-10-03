import { WebSocket } from "ws";
import type { RemoteSocketLike } from "../../shared/remote-client";

const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * 상태 연결용 소켓. 꺼져 있거나 닿지 않는 호스트는 흔한 일이다 — `ws`는 듣는 곳 없는 error를 예외로
 * 던지므로 받아 두기만 한다. 뒤따르는 close가 RemoteClient의 재시도로 이어진다. 응답 없는 Tailscale
 * 주소에 오래 매달리지 않게 핸드셰이크에는 시간 제한을 둔다.
 */
export function createStatusSocket(url: string): RemoteSocketLike {
  const socket = new WebSocket(url, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS });
  socket.on("error", () => undefined);
  return socket;
}
