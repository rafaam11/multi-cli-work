import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { TerminalSessionView } from "../../shared/api-types";
import type {
  ActivePullRequestReview, GitHubRemote, PullRequestReviewAgent, PullRequestReviewFinishRequest,
  PullRequestReviewFinishResult, PullRequestReviewStartResult,
} from "../../shared/github-types";
import type { SharedProject } from "../../shared/project-types";
import type { SharedWorktree, WorktreeRemovalResult } from "../../shared/worktree-types";
import { defaultWorktreePath } from "../projects/git-worktree";
import { addWorktreeEntry, readWorktreeRegistry, removeWorktreeEntry } from "../projects/worktree-registry";
import { GitHubClient } from "./github-client";
import { listGitHubRemotes } from "./github-remote";
import { readReviewRegistry, removeReview, upsertReview, type ReviewRegistryOptions } from "./review-registry";

const execFileAsync = promisify(execFile);
const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";

export function pullRequestReviewPrompt(remote: GitHubRemote, prNumber: number, base: string, headSha: string): string {
  return `항상 한국어로 GitHub PR 리뷰를 수행하세요.

대상: ${remote.host}/${remote.owner}/${remote.repository} PR #${prNumber}
검토 범위: base ${base} 와 고정된 head ${headSha} 사이의 변경만 검토하세요.

- 기존 리뷰와 중복되는 지적을 피하세요.
- 정확성, 회귀, 보안, 오류 처리, 테스트 누락을 우선하고 의미 없는 스타일 지적은 제외하세요.
- 저장소에 문서화된 관련 테스트를 자동 실행하세요.
- 게시 직전 현재 PR HEAD를 다시 확인하고 ${headSha}와 다르면 리뷰를 게시하지 마세요.
- 발견사항은 가능한 경우 인라인 코멘트로 묶어 하나의 리뷰로 제출하세요.
- 차단 이슈가 있으면 REQUEST_CHANGES, 비차단 지적만 있으면 COMMENT, 유효한 지적이 없으면 APPROVE를 선택하세요.
- 자신의 PR이거나 권한이 없으면 COMMENT로 대체하세요.
- 게시 후 리뷰 URL과 테스트 결과를 터미널에 요약하세요.
- 워크트리를 직접 제거하지 말고 앱의 '리뷰 완료' 버튼에 맡기세요.`;
}

interface ReviewServiceOptions {
  registryPath?: string;
  worktreeRegistryPath?: string;
  getProject(projectId: string): Promise<SharedProject | null>;
  createSession(input: { projectId: string; worktreeId: string; kind: PullRequestReviewAgent; cols: number; rows: number }): Promise<TerminalSessionView>;
  attachSession(sessionId: string): Promise<unknown>;
  writeSession(sessionId: string, data: string): Promise<void>;
  removeSession(sessionId: string): Promise<void>;
  listSessions(): TerminalSessionView[];
  removeWorktree(worktreeId: string, force: boolean): Promise<WorktreeRemovalResult>;
  idFactory(): string;
  now(): string;
  client?: GitHubClient;
}

export class PullRequestReviewService {
  private readonly registryOptions: ReviewRegistryOptions;
  private readonly client: GitHubClient;
  constructor(private readonly options: ReviewServiceOptions) {
    this.registryOptions = options.registryPath ? { registryPath: options.registryPath } : {};
    this.client = options.client ?? new GitHubClient();
  }

  async list(): Promise<ActivePullRequestReview[]> {
    const { registry } = await readReviewRegistry(this.registryOptions);
    return Object.values(registry.reviews).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  private async context(projectId: string, remoteName: string): Promise<{ project: SharedProject; remote: GitHubRemote }> {
    const project = await this.options.getProject(projectId);
    if (!project) throw new Error(`Unknown project: ${projectId}`);
    const remote = (await listGitHubRemotes(project.rootPath)).find((item) => item.name === remoteName);
    if (!remote) throw new Error(`GitHub remote를 찾을 수 없습니다: ${remoteName}`);
    return { project, remote };
  }

  async start(projectId: string, remoteName: string, prNumber: number, agent: PullRequestReviewAgent): Promise<PullRequestReviewStartResult> {
    const existing = (await this.list()).find((review) => review.projectId === projectId && review.remoteName === remoteName && review.pullRequestNumber === prNumber);
    if (existing) {
      const worktree = await this.requireWorktree(existing.worktreeId);
      const session = this.options.listSessions().find((item) => item.id === existing.sessionId);
      if (!session) throw new Error("진행 중 리뷰의 세션이 없습니다. 리뷰 완료로 정리한 뒤 다시 시작하세요.");
      const { remote } = await this.context(projectId, remoteName);
      return { review: existing, worktree, session, prompt: pullRequestReviewPrompt(remote, prNumber, "PR base", existing.headSha), reused: true };
    }
    const { project, remote } = await this.context(projectId, remoteName);
    const detail = await this.client.detail(remote, prNumber);
    const headSha = detail.headRefOid;
    const tempRef = `refs/multi-cli-work/pr-${prNumber}-${this.options.idFactory()}`;
    const worktreePath = await this.nextPath(project.rootPath, prNumber, headSha);
    let gitAdded = false; let worktree: SharedWorktree | null = null; let session: TerminalSessionView | null = null;
    try {
      await this.git(project.rootPath, ["fetch", remoteName, `+refs/pull/${prNumber}/head:${tempRef}`], 60_000);
      const fetched = (await this.git(project.rootPath, ["rev-parse", tempRef])).trim();
      if (fetched !== headSha) throw new Error("PR HEAD가 조회 후 변경되었습니다. PR을 새로고침하고 다시 시도하세요.");
      await this.git(project.rootPath, ["worktree", "add", "--detach", worktreePath, tempRef], 60_000);
      gitAdded = true;
      const now = this.options.now();
      worktree = { id: this.options.idFactory(), projectId, path: worktreePath, branch: "detached", createdAt: now, updatedAt: now };
      await addWorktreeEntry(worktree, this.options.worktreeRegistryPath ? { registryPath: this.options.worktreeRegistryPath } : {});
      session = await this.options.createSession({ projectId, worktreeId: worktree.id, kind: agent, cols: 120, rows: 36 });
      const review: ActivePullRequestReview = { id: this.options.idFactory(), projectId, remoteName, pullRequestNumber: prNumber, headSha, worktreeId: worktree.id, sessionId: session.id, agent, promptDelivered: false, startedAt: now, updatedAt: now };
      await upsertReview(review, this.registryOptions);
      const prompt = pullRequestReviewPrompt(remote, prNumber, detail.baseRefName, headSha);
      try {
        await this.options.attachSession(session.id);
        await new Promise((resolve) => setTimeout(resolve, 200));
        await this.options.writeSession(session.id, `${BRACKETED_PASTE_START}${prompt}${BRACKETED_PASTE_END}`);
        review.promptDelivered = true; review.updatedAt = this.options.now(); await upsertReview(review, this.registryOptions);
      } catch { /* session remains recoverable; renderer offers refill/copy */ }
      return { review, worktree, session, prompt, reused: false };
    } catch (error) {
      if (session) await this.options.removeSession(session.id).catch(() => undefined);
      if (worktree) await removeWorktreeEntry(worktree.id, this.options.now(), this.options.worktreeRegistryPath ? { registryPath: this.options.worktreeRegistryPath } : {}).catch(() => undefined);
      if (gitAdded) await this.git(project.rootPath, ["worktree", "remove", "--force", worktreePath], 30_000).catch(() => undefined);
      throw error;
    } finally {
      await this.git(project.rootPath, ["update-ref", "-d", tempRef]).catch(() => undefined);
    }
  }

  async refill(reviewId: string): Promise<string> {
    const review = (await this.list()).find((item) => item.id === reviewId);
    if (!review) throw new Error(`Unknown review: ${reviewId}`);
    const { remote } = await this.context(review.projectId, review.remoteName);
    const detail = await this.client.detail(remote, review.pullRequestNumber);
    const prompt = pullRequestReviewPrompt(remote, review.pullRequestNumber, detail.baseRefName, review.headSha);
    await this.options.attachSession(review.sessionId);
    await this.options.writeSession(review.sessionId, `${BRACKETED_PASTE_START}${prompt}${BRACKETED_PASTE_END}`);
    await upsertReview({ ...review, promptDelivered: true, updatedAt: this.options.now() }, this.registryOptions);
    return prompt;
  }

  async finish(reviewId: string, request: PullRequestReviewFinishRequest): Promise<PullRequestReviewFinishResult> {
    const review = (await this.list()).find((item) => item.id === reviewId);
    if (!review) throw new Error(`Unknown review: ${reviewId}`);
    if (!request.allowUnverifiedReview) {
      try {
        const { remote } = await this.context(review.projectId, review.remoteName);
        const posted = await this.client.hasCurrentUserReviewSince(remote, review.pullRequestNumber, review.startedAt);
        if (!posted) return { state: "review-unverified", message: "리뷰 시작 이후 게시된 리뷰를 확인하지 못했습니다." };
      } catch (error) {
        return { state: "verification-unavailable", message: error instanceof Error ? error.message : String(error) };
      }
    }
    const worktreePath = await this.tryWorktreePath(review.worktreeId);
    const removal = await this.options.removeWorktree(review.worktreeId, request.discardChanges);
    if (!removal.removed) return { state: "dirty", message: removal.message };
    await removeReview(review.id, this.options.now(), this.registryOptions);
    const parent = worktreePath ? path.dirname(worktreePath) : "";
    if (parent) await fs.rmdir(parent).catch(() => undefined);
    return { state: "finished" };
  }

  private async requireWorktree(worktreeId: string): Promise<SharedWorktree> {
    const registry = await readWorktreeRegistry(this.options.worktreeRegistryPath ? { registryPath: this.options.worktreeRegistryPath } : {});
    const worktree = registry.worktrees[worktreeId]; if (!worktree) throw new Error(`Unknown worktree: ${worktreeId}`); return worktree;
  }
  private async tryWorktreePath(worktreeId: string) { return this.requireWorktree(worktreeId).then((w) => w.path, () => null); }
  private async nextPath(rootPath: string, prNumber: number, sha: string) {
    const base = defaultWorktreePath(rootPath, `pr-${prNumber}-${sha.slice(0, 7)}`);
    for (let suffix = 1; ; suffix += 1) { const candidate = suffix === 1 ? base : `${base}-${suffix}`; if (!await fs.stat(candidate).then(() => true, () => false)) return candidate; }
  }
  private async git(rootPath: string, args: string[], timeout = 10_000): Promise<string> {
    const result = await execFileAsync("git", ["-C", rootPath, ...args], { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }); return result.stdout;
  }
}
