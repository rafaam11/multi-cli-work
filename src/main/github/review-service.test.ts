import { describe, expect, it } from "vitest";
import { pullRequestReviewPrompt } from "./review-service";

describe("PR review prompt", () => {
  const prompt = pullRequestReviewPrompt({ name: "origin", url: "git@github.com:a/b.git", host: "github.com", owner: "a", repository: "b" }, 42, "main", "a".repeat(40));
  it("pins the exact range and Korean review contract", () => {
    expect(prompt).toContain("항상 한국어"); expect(prompt).toContain("base main"); expect(prompt).toContain("a".repeat(40));
    expect(prompt).toContain("기존 리뷰와 중복"); expect(prompt).toContain("REQUEST_CHANGES"); expect(prompt).toContain("APPROVE");
    expect(prompt).toContain("현재 PR HEAD"); expect(prompt).toContain("테스트를 자동 실행");
  });
  it("does not carry a carriage return that would submit the terminal input", () => { expect(prompt).not.toContain("\r"); });
});
