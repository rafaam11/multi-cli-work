import { describe, expect, it, vi } from "vitest";
import { fetchLinearProjectContext, linearFailureMessage, verifyLinearKey, type FetchLike } from "./linear-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function projectNode(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    url: `https://linear.app/ws/project/${encodeURIComponent(name)}`,
    projectUpdates: { nodes: [{ health: "onTrack", body: "설계 승인\n세부", createdAt: "2026-11-23T00:00:00.000Z" }] },
    issues: {
      nodes: [
        {
          identifier: "SB-41",
          title: "세션 브리프 Linear 절",
          dueDate: "2026-11-30",
          priority: 2,
          state: { name: "진행 중", type: "started" },
          labels: { nodes: [{ name: "repo:multi-cli-work" }] },
          comments: { nodes: [{ body: "[mcw-claude] 첫 기록", createdAt: "2026-11-22T01:00:00.000Z" }] },
        },
        {
          identifier: "SB-38",
          title: "판정표 채우기",
          dueDate: null,
          priority: 0,
          state: { name: "할 일", type: "unstarted" },
          labels: { nodes: [] },
          comments: { nodes: [{ body: "[메타몽] 브리핑 도착", createdAt: "2026-11-23T02:00:00.000Z" }] },
        },
      ],
    },
    ...overrides,
  };
}

describe("verifyLinearKey", () => {
  it("sends the key without Bearer", async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse({ data: { viewer: { id: "u1" } } }));
    await verifyLinearKey("lin_api_x", { fetch });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.linear.app/graphql");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("lin_api_x");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("throws a Korean message for a rejected key", async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse({ errors: [{ message: "x" }] }, 401));
    await expect(verifyLinearKey("bad", { fetch })).rejects.toThrow("Linear API 키가 거부됐습니다");
  });
});

describe("fetchLinearProjectContext", () => {
  it("filters projects by name prefix and picks the exact key", async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      jsonResponse({ data: { projects: { nodes: [projectNode("PRJ-00170 다른 것"), projectNode("PRJ-0017 세컨드브레인")] } } }),
    );
    const result = await fetchLinearProjectContext("lin_api_x", "PRJ-0017", { fetch });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.context.name).toBe("PRJ-0017 세컨드브레인");
    const body = JSON.parse(String(fetch.mock.calls[0][1].body)) as { variables: { prjKey: string } };
    expect(body.variables.prjKey).toBe("PRJ-0017");
  });

  it("flattens issues, labels, updates and comments", async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse({ data: { projects: { nodes: [projectNode("PRJ-0017")] } } }));
    const result = await fetchLinearProjectContext("lin_api_x", "PRJ-0017", { fetch });
    if (result.kind !== "ok") throw new Error(result.kind);
    expect(result.context.issues[0]).toEqual({
      identifier: "SB-41",
      title: "세션 브리프 Linear 절",
      stateName: "진행 중",
      stateType: "started",
      dueDate: "2026-11-30",
      priority: 2,
      labels: ["repo:multi-cli-work"],
    });
    expect(result.context.updates).toEqual([{ health: "onTrack", body: "설계 승인\n세부", createdAt: "2026-11-23T00:00:00.000Z" }]);
    expect(result.context.comments.map((comment) => comment.issueIdentifier)).toEqual(["SB-38", "SB-41"]);
  });

  it("maps 401 and AUTHENTICATION_ERROR to unauthorized", async () => {
    const http401 = vi.fn<FetchLike>(async () => jsonResponse({}, 401));
    const gql = vi.fn<FetchLike>(async () =>
      jsonResponse({ errors: [{ message: "auth", extensions: { code: "AUTHENTICATION_ERROR" } }] }),
    );
    await expect(fetchLinearProjectContext("k", "PRJ-0017", { fetch: http401 })).resolves.toEqual({ kind: "unauthorized" });
    await expect(fetchLinearProjectContext("k", "PRJ-0017", { fetch: gql })).resolves.toEqual({ kind: "unauthorized" });
  });

  it("maps 429 and RATELIMITED to rate-limited", async () => {
    const http429 = vi.fn<FetchLike>(async () => jsonResponse({}, 429));
    const gql = vi.fn<FetchLike>(async () => jsonResponse({ errors: [{ message: "slow", extensions: { code: "RATELIMITED" } }] }));
    await expect(fetchLinearProjectContext("k", "PRJ-0017", { fetch: http429 })).resolves.toEqual({ kind: "rate-limited" });
    await expect(fetchLinearProjectContext("k", "PRJ-0017", { fetch: gql })).resolves.toEqual({ kind: "rate-limited" });
  });

  it("maps abort and non-JSON to network-error", async () => {
    const aborting = vi.fn<FetchLike>(async (_url, init) => {
      await new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      throw new Error("unreachable");
    });
    const html = vi.fn<FetchLike>(async () => new Response("<html>", { status: 200 }));
    await expect(fetchLinearProjectContext("k", "PRJ-0017", { fetch: aborting, timeoutMs: 20 })).resolves.toEqual({ kind: "network-error" });
    await expect(fetchLinearProjectContext("k", "PRJ-0017", { fetch: html })).resolves.toEqual({ kind: "network-error" });
  });

  it("returns no-project when no name matches", async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse({ data: { projects: { nodes: [projectNode("PRJ-00170")] } } }));
    await expect(fetchLinearProjectContext("k", "PRJ-0017", { fetch })).resolves.toEqual({ kind: "no-project" });
  });

  it("has a Korean message for every failure", () => {
    expect(linearFailureMessage("unauthorized")).toBe("Linear API 키가 거부됐습니다");
    expect(linearFailureMessage("rate-limited")).toBe("Linear 요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요");
    expect(linearFailureMessage("network-error")).toBe("Linear에 연결할 수 없습니다");
    expect(linearFailureMessage("no-project")).toBe("이 PRJ의 Linear 프로젝트를 찾지 못했습니다");
  });
});
