export const REVIEW_SESSION_MESSAGE = "진행 중인 PR 리뷰 세션은 '리뷰 완료' 흐름에서 정리하세요.";

/**
 * A session a pull request review is running in is only cleaned up by finishing the review — that
 * flow also tears down the review's worktree and notes. Every path that removes a session goes
 * through this: the renderer's IPC and the remote protocol.
 */
export function assertNotReviewSession(reviews: ReadonlyArray<{ sessionId: string | null }>, sessionId: string): void {
  if (reviews.some((review) => review.sessionId === sessionId)) throw new Error(REVIEW_SESSION_MESSAGE);
}
