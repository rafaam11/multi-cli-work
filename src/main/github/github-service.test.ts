import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequestListPage, PullRequestListQuery } from "../../shared/github-types";
import { GitHubService } from "./github-service";

vi.mock("./github-remote", () => ({ listGitHubRemotes: vi.fn().mockResolvedValue([{ name: "origin", url: "", host: "github.com", owner: "a", repository: "b" }]) }));

describe("GitHubService list cache", () => {
  const page: PullRequestListPage = { items: [], nextCursor: null, fetchedAt: "2026-07-27T00:00:00Z" };
  const list = vi.fn(async (_remote: unknown, _query: PullRequestListQuery) => page);
  const service = new GitHubService({
    getProject: async () => ({ id: "p", rootPath: "D:/repo" }) as never,
    createAuthSession: async () => ({}) as never,
    reviews: {} as never,
    client: { list } as never,
    now: () => 1_000,
  });

  beforeEach(() => list.mockClear());

  it("isolates state, search and cursor while reusing identical queries", async () => {
    const query = { state: "open", reviewRequested: false, search: "bug" } as const;
    await service.list("p", "origin", query); await service.list("p", "origin", query);
    await service.list("p", "origin", { ...query, state: "closed" });
    await service.list("p", "origin", { ...query, search: "docs" });
    await service.list("p", "origin", { ...query, cursor: 30 });
    expect(list).toHaveBeenCalledTimes(4);
  });

  it("bypasses an existing entry when refresh is true", async () => {
    const query = { state: "open", reviewRequested: false, search: "" } as const;
    await service.list("p", "origin", query); await service.list("p", "origin", { ...query, refresh: true });
    expect(list).toHaveBeenCalledTimes(2);
  });
});
