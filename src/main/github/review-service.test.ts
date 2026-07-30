import { describe, expect, it, vi } from "vitest";
import { PullRequestReviewService, pullRequestReviewPrompt } from "./review-service";

describe("PR review prompt", () => {
  const prompt = pullRequestReviewPrompt({ name: "origin", url: "git@github.com:a/b.git", host: "github.com", owner: "a", repository: "b" }, 42, "main", "a".repeat(40));
  it("pins the exact range and Korean review contract", () => {
    expect(prompt).toContain("항상 한국어"); expect(prompt).toContain("base main"); expect(prompt).toContain("a".repeat(40));
    expect(prompt).toContain("기존 리뷰와 중복"); expect(prompt).toContain("REQUEST_CHANGES"); expect(prompt).toContain("APPROVE");
    expect(prompt).toContain("현재 PR HEAD"); expect(prompt).toContain("테스트를 자동 실행");
  });
  it("does not carry a carriage return that would submit the terminal input", () => { expect(prompt).not.toContain("\r"); });
});

describe("PullRequestReviewService start single-flight", () => {
  it("shares concurrent starts for the same PR and lets the first agent win", async () => {
    const service = new PullRequestReviewService({
      getProject: vi.fn(), createSession: vi.fn(), attachSession: vi.fn(), writeSession: vi.fn(),
      removeSession: vi.fn(), listSessions: vi.fn(() => []), removeWorktree: vi.fn(),
      idFactory: () => "id", now: () => "2026-07-30T00:00:00.000Z",
    });
    let resolve!: (value: { reused: boolean }) => void;
    const result = new Promise<{ reused: boolean }>((next) => { resolve = next; });
    const startOnce = vi.spyOn(service as never, "startOnce" as never).mockReturnValue(result as never);

    const first = service.start("project", "origin", 12, "claude");
    const second = service.start("project", "origin", 12, "codex");
    resolve({ reused: false });

    await expect(first).resolves.toEqual({ reused: false });
    await expect(second).resolves.toEqual({ reused: false });
    expect(startOnce).toHaveBeenCalledOnce();
    expect(startOnce).toHaveBeenCalledWith("project", "origin", 12, "claude");
  });
});
