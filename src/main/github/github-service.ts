import type { TerminalSessionView } from "../../shared/api-types";
import type { GitHubIntegrationStatus, GitHubRemote, PullRequestDetail, PullRequestDiffFile, PullRequestListPage, PullRequestListQuery, PullRequestReviewAgent, PullRequestReviewFinishRequest, PullRequestReviewFinishResult, PullRequestReviewStartResult, ActivePullRequestReview } from "../../shared/github-types";
import type { SharedProject } from "../../shared/project-types";
import { GitHubClient } from "./github-client";
import { listGitHubRemotes } from "./github-remote";
import type { PullRequestReviewService } from "./review-service";

interface GitHubServiceOptions {
  getProject(projectId: string): Promise<SharedProject | null>;
  createAuthSession(projectId: string, host: string): Promise<TerminalSessionView>;
  reviews: PullRequestReviewService;
  client?: GitHubClient;
  now?(): number;
}

export class GitHubService {
  private readonly client: GitHubClient;
  private readonly cache = new Map<string, { at: number; value: PullRequestListPage }>();
  constructor(private readonly options: GitHubServiceOptions) { this.client = options.client ?? new GitHubClient(); }
  private async project(projectId: string) { const value = await this.options.getProject(projectId); if (!value) throw new Error(`Unknown project: ${projectId}`); return value; }
  async remotes(projectId: string): Promise<GitHubRemote[]> { return listGitHubRemotes((await this.project(projectId)).rootPath); }
  private async remote(projectId: string, name: string) { const remote = (await this.remotes(projectId)).find((item) => item.name === name); if (!remote) throw new Error(`Unknown GitHub remote: ${name}`); return remote; }
  async status(projectId: string, name: string): Promise<GitHubIntegrationStatus> { return this.client.status(await this.remote(projectId, name)); }
  async authenticate(projectId: string, name: string) { const remote = await this.remote(projectId, name); return this.options.createAuthSession(projectId, remote.host); }
  async list(projectId: string, name: string, query: PullRequestListQuery): Promise<PullRequestListPage> {
    const key = JSON.stringify([projectId, name, { ...query, refresh: undefined }]); const now = (this.options.now ?? Date.now)(); const cached = this.cache.get(key);
    if (!query.refresh && cached && now - cached.at < 30_000) return cached.value;
    const value = await this.client.list(await this.remote(projectId, name), query); this.cache.set(key, { at: now, value }); return value;
  }
  async detail(projectId: string, name: string, prNumber: number): Promise<PullRequestDetail> { return this.client.detail(await this.remote(projectId, name), prNumber); }
  async diff(projectId: string, name: string, prNumber: number): Promise<PullRequestDiffFile[]> { return this.client.diff(await this.remote(projectId, name), prNumber); }
  async comment(projectId: string, name: string, prNumber: number, body: string) { return this.client.addComment(await this.remote(projectId, name), prNumber, body); }
  async reply(projectId: string, name: string, prNumber: number, commentId: string, body: string) { return this.client.replyInline(await this.remote(projectId, name), prNumber, commentId, body); }
  activeReviews(): Promise<ActivePullRequestReview[]> { return this.options.reviews.list(); }
  startReview(projectId: string, name: string, prNumber: number, agent: PullRequestReviewAgent): Promise<PullRequestReviewStartResult> { return this.options.reviews.start(projectId, name, prNumber, agent); }
  refillReview(reviewId: string) { return this.options.reviews.refill(reviewId); }
  finishReview(reviewId: string, request: PullRequestReviewFinishRequest): Promise<PullRequestReviewFinishResult> { return this.options.reviews.finish(reviewId, request); }
}
