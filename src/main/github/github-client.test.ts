import { describe, expect, it } from "vitest";
import { classifyGhError, parsePullRequestList } from "./github-client";

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
});
