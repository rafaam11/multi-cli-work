// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { pairWithHost, parsePairInput } from "./pair-host";

const STRICT = { allowLoopback: false };

describe("parsePairInput", () => {
  it("accepts an address and a code", () => {
    expect(parsePairInput({ address: " 100.64.0.9:47821 ", code: " abcd-efgh " }, STRICT)).toEqual({
      address: "100.64.0.9:47821",
      code: "abcd-efgh",
      expectedHostId: null,
    });
  });

  it("accepts the URL the host's settings show", () => {
    expect(parsePairInput({ address: "http://100.64.0.9:47821/mobile/", code: "ABCD-EFGH" }, STRICT).address).toBe(
      "100.64.0.9:47821",
    );
  });

  it.each([
    ["100.64.0.9", "100.x.y.z:포트"],
    ["office-pc:47821", "100.x.y.z:포트"],
    ["192.168.0.5:47821", "Tailscale 주소"],
    ["8.8.8.8:47821", "Tailscale 주소"],
    ["100.64.0.999:47821", "Tailscale 주소"],
    ["127.0.0.1:47821", "Tailscale 주소"],
    ["100.64.0.9:0", "포트"],
    ["100.64.0.9:70000", "포트"],
  ])("rejects addresses outside Tailscale: %s", (address, message) => {
    expect(() => parsePairInput({ address, code: "ABCD-EFGH" }, STRICT)).toThrow(message);
  });

  it("allows loopback only for tests and development", () => {
    expect(parsePairInput({ address: "127.0.0.1:5000", code: "x" }, { allowLoopback: true }).address).toBe("127.0.0.1:5000");
  });

  it("requires a code", () => {
    expect(() => parsePairInput({ address: "100.64.0.9:47821", code: "  " }, STRICT)).toThrow("페어링 코드");
  });

  it("reads a pairing link", () => {
    expect(
      parsePairInput({ uri: "mcw://pair?host=100.64.0.9:47821&name=%ED%9A%8C%EC%82%ACPC&code=ABCDEFGH&fp=host-1" }, STRICT),
    ).toEqual({ address: "100.64.0.9:47821", code: "ABCDEFGH", expectedHostId: "host-1" });
  });

  it.each([
    "https://pair?host=100.64.0.9:47821&code=A&fp=h",
    "mcw://other?host=100.64.0.9:47821&code=A&fp=h",
    "mcw://pair?host=100.64.0.9:47821&code=A",
    "mcw://pair?code=A&fp=h",
    "nonsense",
  ])("rejects a malformed link: %s", (uri) => {
    expect(() => parsePairInput({ uri }, STRICT)).toThrow("페어링 링크");
  });

  it("applies the address rules to a link too", () => {
    expect(() => parsePairInput({ uri: "mcw://pair?host=192.168.0.5:47821&code=A&fp=h" }, STRICT)).toThrow("Tailscale 주소");
  });
});

function response(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

const TARGET = { address: "100.64.0.9:47821", code: "ABCD-EFGH", expectedHostId: null };
const PAIRED = { token: "tok", deviceId: "dev-1", hostId: "host-1", hostName: "회사PC" };

describe("pairWithHost", () => {
  it("posts the code and returns the host's answer", async () => {
    const fetchImpl = vi.fn(async () => response(200, PAIRED));
    expect(await pairWithHost(TARGET, "내 노트북", fetchImpl as unknown as typeof fetch)).toEqual(PAIRED);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://100.64.0.9:47821/pair");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ code: "ABCD-EFGH", deviceName: "내 노트북" });
  });

  it.each([
    [401, "코드가 맞지 않거나 만료되었습니다"],
    [429, "시도가 너무 많습니다"],
    [500, "페어링에 실패했습니다 (500)"],
  ])("explains a %i", async (status, message) => {
    const fetchImpl = vi.fn(async () => response(status, "no"));
    await expect(pairWithHost(TARGET, "x", fetchImpl as unknown as typeof fetch)).rejects.toThrow(message);
  });

  it("explains an unreachable host", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(pairWithHost(TARGET, "x", fetchImpl as unknown as typeof fetch)).rejects.toThrow("호스트에 연결하지 못했습니다");
  });

  it("rejects an answer it cannot read", async () => {
    const fetchImpl = vi.fn(async () => response(200, { token: "tok" }));
    await expect(pairWithHost(TARGET, "x", fetchImpl as unknown as typeof fetch)).rejects.toThrow("응답을 읽을 수 없습니다");
  });

  it("rejects a host that is not the one the link named", async () => {
    const fetchImpl = vi.fn(async () => response(200, PAIRED));
    await expect(
      pairWithHost({ ...TARGET, expectedHostId: "host-other" }, "x", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("다른 PC");
    expect(await pairWithHost({ ...TARGET, expectedHostId: "host-1" }, "x", fetchImpl as unknown as typeof fetch)).toEqual(PAIRED);
  });
});
