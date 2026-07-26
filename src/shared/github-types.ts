export interface GitHubRemote {
  name: string;
  url: string;
  host: string;
  owner: string;
  repository: string;
}

export type GitHubIntegrationState =
  | "ready"
  | "gh-missing"
  | "unauthenticated"
  | "permission-denied"
  | "network-error"
  | "rate-limited"
  | "not-found";

export interface GitHubIntegrationStatus {
  state: GitHubIntegrationState;
  host: string | null;
  message?: string;
}

export type PullRequestState = "OPEN" | "MERGED" | "CLOSED";
export type PullRequestStateFilter = "open" | "merged" | "closed" | "all";

export interface PullRequestListQuery {
  state: PullRequestStateFilter;
  reviewRequested: boolean;
  search: string;
  cursor?: number;
  refresh?: boolean;
}

export interface PullRequestListItem {
  number: number;
  title: string;
  state: PullRequestState;
  isDraft: boolean;
  author: string;
  updatedAt: string;
  reviewDecision: string | null;
  checksState: "success" | "failure" | "pending" | "none";
  url: string;
  headRefOid: string;
}

export interface PullRequestListPage {
  items: PullRequestListItem[];
  nextCursor: number | null;
  fetchedAt: string;
}

export interface PullRequestAuthor { login: string; name?: string | null; }
export interface PullRequestReview {
  id: string;
  author: PullRequestAuthor;
  body: string;
  state: string;
  submittedAt: string | null;
  url: string | null;
}
export interface PullRequestComment {
  id: string;
  author: PullRequestAuthor;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
}
export interface PullRequestInlineComment extends PullRequestComment {
  path: string;
  line: number | null;
  originalLine: number | null;
  side: "LEFT" | "RIGHT" | null;
  inReplyToId: string | null;
}
export type PullRequestTimelineItem =
  | ({ kind: "comment" } & PullRequestComment)
  | ({ kind: "review" } & PullRequestReview)
  | ({ kind: "inline" } & PullRequestInlineComment);

export interface PullRequestFile {
  path: string;
  additions: number;
  deletions: number;
  changeType: string;
}

export interface PullRequestCheck {
  name: string;
  state: string;
  conclusion: string | null;
  detailsUrl: string | null;
}

export interface PullRequestLabel { name: string; color: string; }

export interface PullRequestDetail extends PullRequestListItem {
  body: string;
  authorDetail: PullRequestAuthor;
  labels: PullRequestLabel[];
  baseRefName: string;
  headRefName: string;
  commits: Array<{ oid: string; message: string; committedAt: string }>;
  timeline: PullRequestTimelineItem[];
  files: PullRequestFile[];
  checks: PullRequestCheck[];
}

export interface PullRequestDiffFile {
  path: string;
  patch: string;
  truncated: boolean;
}

export type PullRequestReviewAgent = "claude" | "codex";

export interface ActivePullRequestReview {
  id: string;
  projectId: string;
  remoteName: string;
  pullRequestNumber: number;
  headSha: string;
  worktreeId: string;
  sessionId: string;
  agent: PullRequestReviewAgent;
  promptDelivered: boolean;
  startedAt: string;
  updatedAt: string;
}

export interface PullRequestReviewStartResult {
  review: ActivePullRequestReview;
  worktree: import("./worktree-types").SharedWorktree;
  session: import("./api-types").TerminalSessionView;
  prompt: string;
  reused: boolean;
}

export interface PullRequestReviewFinishRequest {
  allowUnverifiedReview: boolean;
  discardChanges: boolean;
}

export type PullRequestReviewFinishResult =
  | { state: "review-unverified"; message: string }
  | { state: "verification-unavailable"; message: string }
  | { state: "dirty"; message: string }
  | { state: "finished" };

export interface PullRequestReviewRegistryV1 {
  schemaVersion: 1;
  updatedAt: string;
  reviews: Record<string, ActivePullRequestReview>;
}
