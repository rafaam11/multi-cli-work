import type { RemotePairResponse } from "@shared/remote-types";

// 연결 자체(재연결·백오프)는 다른 PC의 main도 쓰므로 shared에 있다. 여기에는 브라우저에서만 쓰는 것 —
// 페이지 주소에서 소켓 주소 만들기, 페어링 저장, /pair 요청 — 이 남는다.
export { RemoteClient, type RemoteClientOptions, type RemoteClientState } from "@shared/remote-client";

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
