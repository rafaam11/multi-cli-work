import { describe, expect, it, vi } from "vitest";
import { inspectNotionLink, verifyNotionToken, type FetchLike } from "./notion-client";

const PAGE_URL = "https://app.notion.com/p/44c1183735e08258ac3b017e876998a1?pvs=204";
const PAGE_ID = "44c11837-35e0-8258-ac3b-017e876998a1";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** 경로별 응답을 지정하는 가짜 fetch. 지정하지 않은 경로는 404다. */
function routes(table: Record<string, Response | (() => Response)>): FetchLike {
  return vi.fn(async (input: string) => {
    const pathname = new URL(input).pathname;
    const hit = table[pathname];
    if (!hit) return json({ object: "error", code: "object_not_found" }, 404);
    return typeof hit === "function" ? hit() : hit;
  });
}

describe("노션 링크 검증", () => {
  it("페이지 제목을 조각까지 이어붙여 돌려준다", async () => {
    const call = routes({
      [`/v1/pages/${PAGE_ID}`]: json({
        properties: {
          Name: {
            type: "title",
            title: [{ plain_text: "삼성서울병원 " }, { plain_text: "채널" }],
          },
        },
      }),
    });
    await expect(inspectNotionLink("secret_x", PAGE_URL, { fetch: call })).resolves.toEqual({
      state: "ok",
      title: "삼성서울병원 채널",
      message: null,
    });
  });

  it("페이지가 아니면 데이터베이스로 한 번 더 물어본다", async () => {
    const call = routes({
      [`/v1/databases/${PAGE_ID}`]: json({ title: [{ plain_text: "스프린트 태스크" }] }),
    });
    await expect(inspectNotionLink("secret_x", PAGE_URL, { fetch: call })).resolves.toEqual({
      state: "ok",
      title: "스프린트 태스크",
      message: null,
    });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("양쪽 다 404면 통합에 연결되지 않은 것으로 본다", async () => {
    const result = await inspectNotionLink("secret_x", PAGE_URL, { fetch: routes({}) });
    expect(result.state).toBe("not-shared");
    expect(result.message).toContain("통합에 연결되어 있지 않습니다");
  });

  it("제목이 비어 있어도 접근 가능은 접근 가능이다", async () => {
    const call = routes({
      [`/v1/pages/${PAGE_ID}`]: json({ properties: { Name: { type: "title", title: [] } } }),
    });
    await expect(inspectNotionLink("secret_x", PAGE_URL, { fetch: call })).resolves.toEqual({
      state: "ok",
      title: null,
      message: null,
    });
  });

  it("401과 403은 토큰 문제로, 429는 한도 초과로 분류한다", async () => {
    const unauthorized = routes({ [`/v1/pages/${PAGE_ID}`]: json({}, 401) });
    const restricted = routes({ [`/v1/pages/${PAGE_ID}`]: json({}, 403) });
    const throttled = routes({ [`/v1/pages/${PAGE_ID}`]: json({}, 429) });
    await expect(inspectNotionLink("x", PAGE_URL, { fetch: unauthorized })).resolves.toMatchObject({
      state: "unauthorized",
    });
    await expect(inspectNotionLink("x", PAGE_URL, { fetch: restricted })).resolves.toMatchObject({
      state: "unauthorized",
    });
    await expect(inspectNotionLink("x", PAGE_URL, { fetch: throttled })).resolves.toMatchObject({
      state: "rate-limited",
    });
  });

  it("페이지가 404여도 데이터베이스 쪽이 401이면 토큰 문제로 보고한다", async () => {
    const call = routes({ [`/v1/databases/${PAGE_ID}`]: json({}, 401) });
    await expect(inspectNotionLink("x", PAGE_URL, { fetch: call })).resolves.toMatchObject({
      state: "unauthorized",
    });
  });

  it("응답이 없으면 타임아웃으로 끊고 네트워크 오류로 보고한다", async () => {
    const hanging: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    await expect(inspectNotionLink("x", PAGE_URL, { fetch: hanging, timeoutMs: 5 })).resolves.toMatchObject({
      state: "network-error",
    });
  });

  it("노션 URL이 아니면 요청조차 하지 않는다", async () => {
    const call = routes({});
    await expect(inspectNotionLink("x", "https://example.com/page", { fetch: call })).resolves.toMatchObject({
      state: "not-notion",
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("토큰을 헤더에 실어 고정된 API 버전으로 부른다", async () => {
    const call = routes({ [`/v1/pages/${PAGE_ID}`]: json({ properties: {} }) });
    await inspectNotionLink("secret_abc", PAGE_URL, { fetch: call });
    const [, init] = (call as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      Authorization: "Bearer secret_abc",
      "Notion-Version": "2022-06-28",
    });
  });
});

describe("노션 토큰 확인", () => {
  it("사용자 조회가 통과하면 아무것도 던지지 않는다", async () => {
    const call = routes({ "/v1/users/me": json({ object: "user" }) });
    await expect(verifyNotionToken("secret_ok", { fetch: call })).resolves.toBeUndefined();
  });

  it("실패하면 한국어 사유로 던지고 토큰은 메시지에 넣지 않는다", async () => {
    const call = routes({ "/v1/users/me": json({}, 401) });
    await expect(verifyNotionToken("secret_leaky", { fetch: call })).rejects.toThrow(
      /노션 토큰이 유효하지 않습니다/,
    );
    await verifyNotionToken("secret_leaky", { fetch: call }).catch((error: Error) => {
      expect(error.message).not.toContain("secret_leaky");
    });
  });
});
