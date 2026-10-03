// @vitest-environment node

import { describe, expect, it } from "vitest";
import { assertNotReviewSession, REVIEW_SESSION_MESSAGE } from "./review-guard";

describe("assertNotReviewSession", () => {
  const reviews = [{ sessionId: "s-review" }, { sessionId: null }];

  it("refuses to remove a session that a pull request review is running in", () => {
    expect(() => assertNotReviewSession(reviews, "s-review")).toThrow(REVIEW_SESSION_MESSAGE);
  });

  it("lets every other session go", () => {
    expect(() => assertNotReviewSession(reviews, "s-other")).not.toThrow();
    expect(() => assertNotReviewSession([], "s-review")).not.toThrow();
  });
});
