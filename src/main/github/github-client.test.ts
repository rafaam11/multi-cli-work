import { describe, expect, it, vi } from "vitest";
import { classifyGhError, GitHubClient, parsePullRequestList } from "./github-client";

describe("GitHub client validation", () => {
  it("validates and converts PR list JSON", () => {
    const result = parsePullRequestList(JSON.stringify([{
      number: 12, title: "Fix", state: "OPEN", isDraft: false,
      author: { login: "octo" }, updatedAt: "2026-07-24T00:00:00Z",
      reviewDecision: "APPROVED", url: "https://github.com/a/b/pull/12", headRefOid: "a".repeat(40),
      statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }],
    }]));
    expect(result[0]).toMatchObject({ number: 12, author: "octo", checksState: "success" });
  });

  it("rejects malformed external JSON", () => {
    expect(() => parsePullRequestList('[{"number":"12"}]')).toThrow(/number/);
  });

  it.each([
    [{ code: "ENOENT", stderr: "" }, "gh-missing"],
    [{ code: 1, stderr: "not logged into any GitHub hosts" }, "unauthenticated"],
    [{ code: 1, stderr: "HTTP 403 Resource not accessible" }, "permission-denied"],
    [{ code: 1, stderr: "API rate limit exceeded" }, "rate-limited"],
    [{ code: 1, stderr: "could not resolve host" }, "network-error"],
    [{ code: 1, stderr: "could not resolve to a PullRequest" }, "not-found"],
  ])("classifies gh failures", (failure, state) => {
    expect(classifyGhError(failure).state).toBe(state);
  });

  it("keeps only valid six digit GitHub label colors", async () => {
    const raw = {
      number: 12, title: "Fix", state: "OPEN", isDraft: false, author: { login: "octo" },
      updatedAt: "2026-07-24T00:00:00Z", reviewDecision: null, statusCheckRollup: [],
      url: "https://github.com/a/b/pull/12", headRefOid: "a".repeat(40), body: "", baseRefName: "main", headRefName: "fix",
      labels: [{ name: "bug", color: "b60205" }, { name: "bad", color: "#fff" }], commits: [], reviews: [], comments: [], files: [],
    };
    const run = vi.fn().mockResolvedValueOnce({ stdout: JSON.stringify(raw), stderr: "" }).mockResolvedValueOnce({ stdout: "[]", stderr: "" });
    const detail = await new GitHubClient(run).detail({ name: "origin", url: "", host: "github.com", owner: "a", repository: "b" }, 12);
    expect(detail.labels).toEqual([{ name: "bug", color: "b60205" }, { name: "bad", color: "" }]);
  });

  it("ignores patch preambles and keeps quoted paths", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "From abc Mon Sep 17 00:00:00 2001\nSubject: [PATCH]\n\ndiff --git \"a/my file.txt\" \"b/my file.txt\"\n@@ -1 +1 @@\n-old\n+new\n", stderr: "" });
    const files = await new GitHubClient(run).diff({ name: "origin", url: "", host: "github.com", owner: "a", repository: "b" }, 12);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("my file.txt");
  });
});
