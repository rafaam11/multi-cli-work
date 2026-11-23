import { describe, expect, it, vi } from "vitest";
import { fetchLinearProjectContext, linearFailureMessage, verifyLinearKey, type FetchLike } from "./linear-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const ISSUES = [
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
];

interface FakeProject {
  id: string;
  name: string;
  content?: string;
  description?: string;
}

/** Answers the two queries the client sends: the project directory, then one project's open issues. */
function linearApi(projects: FakeProject[]) {
  return vi.fn<FetchLike>(async (_url, init) => {
    const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    if (body.query.includes("ProjectDirectory")) {
      return jsonResponse({
        data: { projects: { nodes: projects.map((project) => ({ url: `https://linear.app/ws/project/${project.id}`, description: "", content: "", ...project })) } },
      });
    }
    const project = projects.find((candidate) => candidate.id === body.variables.id);
    return jsonResponse({
      data: { project: project ? { name: project.name, url: `https://linear.app/ws/project/${project.id}`, issues: { nodes: ISSUES } } : null },
    });
  });
}

const requests = (fetch: ReturnType<typeof linearApi>) =>
  fetch.mock.calls.map(([, init]) => JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> });

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
  it("finds the project whose content lists the key among several", async () => {
    // System roles audit: four broad Linear projects, each listing its PRJ keys on the first line of the project content.
    const fetch = linearApi([
      { id: "company", name: "회사", content: "projectKey: PRJ-0005, PRJ-0010" },
      { id: "brain", name: "세컨드브레인", content: "projectKey: PRJ-0017, PRJ-0013\n세컨드브레인 전반" },
    ]);
    const result = await fetchLinearProjectContext("lin_api_x", "PRJ-0013", { fetch });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.context.name).toBe("세컨드브레인");
    expect(requests(fetch)[1].variables.id).toBe("brain");
  });

  it("also accepts the key line in the short description field", async () => {
    const fetch = linearApi([{ id: "brain", name: "세컨드브레인", description: "projectKey: PRJ-0017" }]);
    const result = await fetchLinearProjectContext("lin_api_x", "PRJ-0017", { fetch });
    expect(result.kind === "ok" && result.context.name).toBe("세컨드브레인");
  });

  it("keeps a project named after the key as a fallback", async () => {
    const fetch = linearApi([{ id: "old", name: "PRJ-0017 세컨드브레인" }]);
    const result = await fetchLinearProjectContext("lin_api_x", "PRJ-0017", { fetch });
    expect(result.kind === "ok" && result.context.name).toBe("PRJ-0017 세컨드브레인");
  });

  it("ignores keys outside the first projectKey line and near-miss keys", async () => {
    const fetch = linearApi([
      { id: "later", name: "나중 줄", content: "소개 문장\nprojectKey: PRJ-0017" },
      { id: "near-name", name: "PRJ-00170 다른 것" },
      { id: "near-key", name: "다른 키", content: "projectKey: PRJ-00170, PRJ-10017" },
    ]);
    await expect(fetchLinearProjectContext("k", "PRJ-0017", { fetch })).resolves.toEqual({ kind: "no-project" });
    expect(requests(fetch)).toHaveLength(1);
  });

  it("flattens issues, labels and comments", async () => {
    const fetch = linearApi([{ id: "brain", name: "세컨드브레인", content: "projectKey: PRJ-0017" }]);
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
    expect("updates" in result.context).toBe(false);
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

  it("maps a failure of the second query the same way", async () => {
    let call = 0;
    const fetch = vi.fn<FetchLike>(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ data: { projects: { nodes: [{ id: "brain", name: "세컨드브레인", url: "u", content: "projectKey: PRJ-0017" }] } } })
        : jsonResponse({}, 429);
    });
    await expect(fetchLinearProjectContext("k", "PRJ-0017", { fetch })).resolves.toEqual({ kind: "rate-limited" });
  });

  it("bounds every connection so each query stays under Linear's complexity cap", async () => {
    // Linear multiplies a connection by `first` (default 50) and rejects queries above 10,000 points.
    const fetch = linearApi([{ id: "brain", name: "세컨드브레인", content: "projectKey: PRJ-0017" }]);
    await fetchLinearProjectContext("k", "PRJ-0017", { fetch });
    const [directory, issues] = requests(fetch).map((request) => request.query);
    const bound = (query: string, field: string) =>
      Number(new RegExp(`\\b${field}\\([^)]*first:\\s*(\\d+)`).exec(query)?.[1] ?? Number.NaN);
    expect(bound(directory, "projects")).toBeLessThanOrEqual(50);
    expect(bound(issues, "issues")).toBeLessThanOrEqual(50);
    expect(bound(issues, "labels")).toBeLessThanOrEqual(10);
    expect(bound(issues, "comments")).toBeLessThanOrEqual(3);
    // Linear project updates are not used (system roles audit A4): no query asks for them.
    expect(`${directory}${issues}`).not.toContain("projectUpdates");
  });

  it("maps other GraphQL errors to rejected, not to a network error", async () => {
    const tooComplex = vi.fn<FetchLike>(async () =>
      jsonResponse({ errors: [{ message: "Query too complex", extensions: { code: "INVALID_INPUT" } }] }, 400),
    );
    await expect(fetchLinearProjectContext("k", "PRJ-0017", { fetch: tooComplex })).resolves.toEqual({ kind: "rejected" });
    expect(linearFailureMessage("rejected")).toBe("Linear가 조회를 거부했습니다(쿼리 오류)");
  });

  it("returns no-project when nothing lists the key", async () => {
    const fetch = linearApi([{ id: "company", name: "회사", content: "projectKey: PRJ-0005" }]);
    await expect(fetchLinearProjectContext("k", "PRJ-0017", { fetch })).resolves.toEqual({ kind: "no-project" });
  });

  it("has a Korean message for every failure", () => {
    expect(linearFailureMessage("unauthorized")).toBe("Linear API 키가 거부됐습니다");
    expect(linearFailureMessage("rate-limited")).toBe("Linear 요청 한도에 걸렸습니다. 잠시 후 다시 시도하세요");
    expect(linearFailureMessage("network-error")).toBe("Linear에 연결할 수 없습니다");
    expect(linearFailureMessage("no-project")).toBe("이 PRJ의 Linear 프로젝트를 찾지 못했습니다");
  });
});
