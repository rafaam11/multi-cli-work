import type { RemoteHostAddInput, RemotePairResponse } from "../../shared/remote-types";
import { isTailscaleAddress } from "../remote/tailscale-address";

export interface PairTarget {
  /** "100.x.y.z:47821" */
  address: string;
  code: string;
  /** 페어링 링크로 추가했을 때 그 링크가 가리킨 호스트. 응답이 다르면 저장하지 않는다. */
  expectedHostId: string | null;
}

const PAIR_TIMEOUT_MS = 10_000;
const BAD_LINK = "페어링 링크를 읽을 수 없습니다";

/**
 * 호스트 주소는 Tailscale IPv4와 포트만 받는다 — 호스트가 그 주소에만 bind하는 것과 같은 규칙이다.
 * 호스트 설정이 보여 주는 "http://…/mobile/"을 그대로 붙여 넣어도 되게 스킴과 경로는 떼어 낸다.
 */
function normalizeAddress(raw: string, allowLoopback: boolean): string {
  const bare = raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "");
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(bare)) {
    throw new Error("포트가 빠졌습니다. 100.x.y.z:포트 형식으로 입력하세요");
  }
  const match = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/.exec(bare);
  if (!match) throw new Error("주소는 100.x.y.z:포트 형식이어야 합니다");
  const ip = match[1]!;
  const port = Number(match[2]);
  if (!ip.split(".").every((octet) => Number(octet) <= 255)) {
    throw new Error("IP 주소의 각 숫자는 0~255여야 합니다");
  }
  const allowed = isTailscaleAddress(ip) || (allowLoopback && ip === "127.0.0.1");
  if (!allowed) throw new Error("Tailscale 주소(100.64.0.0/10)만 등록할 수 있습니다");
  if (port < 1 || port > 65535) throw new Error("포트가 올바르지 않습니다");
  return `${ip}:${port}`;
}

export function parsePairInput(input: RemoteHostAddInput, options: { allowLoopback: boolean }): PairTarget {
  if ("uri" in input) {
    let url: URL;
    try {
      url = new URL(input.uri.trim());
    } catch {
      throw new Error(BAD_LINK);
    }
    const host = url.searchParams.get("host");
    const code = url.searchParams.get("code");
    const hostId = url.searchParams.get("fp");
    if (url.protocol !== "mcw:" || url.hostname !== "pair" || !host || !code || !hostId) throw new Error(BAD_LINK);
    return { address: normalizeAddress(host, options.allowLoopback), code, expectedHostId: hostId };
  }
  const code = input.code.trim();
  if (code.length === 0) throw new Error("페어링 코드를 입력하세요");
  return { address: normalizeAddress(input.address, options.allowLoopback), code, expectedHostId: null };
}

/** 호스트의 POST /pair로 일회용 코드를 기기 토큰과 바꾼다. */
export async function pairWithHost(
  target: PairTarget,
  deviceName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RemotePairResponse> {
  let response: Response;
  try {
    response = await fetchImpl(`http://${target.address}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: target.code, deviceName }),
      signal: AbortSignal.timeout(PAIR_TIMEOUT_MS),
    });
  } catch {
    throw new Error("호스트에 연결하지 못했습니다. 주소, Tailscale 연결, 그 PC의 원격 접속 허용을 확인하세요");
  }
  if (response.status === 401) throw new Error("코드가 맞지 않거나 만료되었습니다");
  if (response.status === 429) throw new Error("시도가 너무 많습니다. 잠시 후 다시 시도하세요");
  if (!response.ok) throw new Error(`페어링에 실패했습니다 (${response.status})`);
  const body = (await response.json().catch(() => null)) as Partial<RemotePairResponse> | null;
  if (
    !body ||
    typeof body.token !== "string" ||
    typeof body.deviceId !== "string" ||
    typeof body.hostId !== "string" ||
    typeof body.hostName !== "string"
  ) {
    throw new Error("호스트의 응답을 읽을 수 없습니다");
  }
  if (target.expectedHostId !== null && body.hostId !== target.expectedHostId) {
    throw new Error("페어링 링크가 가리킨 PC와 다른 PC가 응답했습니다");
  }
  return { token: body.token, deviceId: body.deviceId, hostId: body.hostId, hostName: body.hostName };
}
