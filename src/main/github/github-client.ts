import { spawn } from "node:child_process";
import type {
  GitHubIntegrationStatus, GitHubRemote, PullRequestCheck, PullRequestDetail, PullRequestDiffFile,
  PullRequestFile, PullRequestInlineComment, PullRequestListItem, PullRequestListPage,
  PullRequestListQuery, PullRequestReview, PullRequestTimelineItem,
} from "../../shared/github-types";

const MAX_DIFF_BYTES = 1024 * 1024;
type ExecFailure = { code?: string | number; stderr?: string; message?: string };

export class GitHubClientError extends Error {
  constructor(public readonly state: GitHubIntegrationStatus["state"], message: string, options?: ErrorOptions) {
    super(message, options); this.name = "GitHubClientError";
  }
}

export function classifyGhError(error: ExecFailure): GitHubIntegrationStatus {
  const text = `${error.stderr ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (error.code === "ENOENT") return { state: "gh-missing", host: null, message: "gh CLI가 설치되어 있지 않습니다." };
  if (/not logged|authentication|authenticate|login/.test(text)) return { state: "unauthenticated", host: null, message: "GitHub 인증이 필요합니다." };
  if (/rate limit|secondary rate/.test(text)) return { state: "rate-limited", host: null, message: "GitHub API 요청 한도를 초과했습니다." };
  if (/not found|could not resolve.*pull\s*request/.test(text)) return { state: "not-found", host: null, message: "PR이 삭제되었거나 더 이상 접근할 수 없습니다." };
  if (/403|forbidden|resource not accessible|permission/.test(text)) return { state: "permission-denied", host: null, message: "저장소 접근 권한이 없습니다." };
  return { state: "network-error", host: null, message: error.stderr?.trim() || error.message || "GitHub에 연결할 수 없습니다." };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}
function number(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
  return value as number;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}
function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}
function author(value: unknown): { login: string; name?: string | null } {
  const item = record(value, "author");
  const result = { login: string(item.login, "author.login")! } as { login: string; name?: string | null };
  if (item.name === null || typeof item.name === "string") result.name = item.name;
  return result;
}
function checkState(value: unknown): PullRequestListItem["checksState"] {
  const checks = Array.isArray(value) ? value.map((item) => record(item, "check")) : [];
  if (checks.length === 0) return "none";
  if (checks.some((item) => ["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(String(item.conclusion)))) return "failure";
  if (checks.every((item) => String(item.conclusion) === "SUCCESS" || String(item.conclusion) === "NEUTRAL" || String(item.conclusion) === "SKIPPED")) return "success";
  return "pending";
}

export function parsePullRequestList(json: string): PullRequestListItem[] {
  return array(JSON.parse(json), "PR list").map((value, index) => {
    const item = record(value, `PR ${index}`);
    const prNumber = number(item.number, `PR ${index}.number`);
    const state = string(item.state, `PR ${index}.state`)!;
    if (!["OPEN", "MERGED", "CLOSED"].includes(state)) throw new Error(`PR ${index}.state is invalid`);
    return {
      number: prNumber, title: string(item.title, `PR ${index}.title`)! ,
      state: state as PullRequestListItem["state"], isDraft: bool(item.isDraft, `PR ${index}.isDraft`),
      author: author(item.author).login, updatedAt: string(item.updatedAt, `PR ${index}.updatedAt`)! ,
      reviewDecision: string(item.reviewDecision ?? null, `PR ${index}.reviewDecision`, true),
      checksState: checkState(item.statusCheckRollup), url: string(item.url, `PR ${index}.url`)! ,
      headRefOid: string(item.headRefOid, `PR ${index}.headRefOid`)! ,
    };
  });
}

export interface GhRunner { (args: string[], options?: { cwd?: string; input?: string }): Promise<{ stdout: string; stderr: string }>; }

async function defaultRun(args: string[], options: { cwd?: string; input?: string } = {}) {
  try {
    return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn("gh", args, { cwd: options.cwd, windowsHide: true, shell: false, stdio: "pipe" });
      const stdout: Buffer[] = []; const stderr: Buffer[] = []; let size = 0;
      const timer = setTimeout(() => child.kill(), 30_000);
      child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size <= 16 * 1024 * 1024) stdout.push(chunk); });
      child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("close", (code) => {
        clearTimeout(timer); const result = { stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") };
        if (code === 0 && size <= 16 * 1024 * 1024) resolve(result);
        else reject(Object.assign(new Error(result.stderr || `gh exited with ${code}`), { code, stderr: result.stderr }));
      });
      child.stdin.end(options.input);
    });
  } catch (error) {
    const status = classifyGhError(error as ExecFailure);
    throw new GitHubClientError(status.state, status.message ?? "gh 실행에 실패했습니다.", { cause: error });
  }
}

function repo(remote: GitHubRemote): string { return `${remote.host}/${remote.owner}/${remote.repository}`; }

export class GitHubClient {
  constructor(private readonly run: GhRunner = defaultRun) {}

  async status(remote: GitHubRemote): Promise<GitHubIntegrationStatus> {
    try {
      await this.run(["--version"]);
      await this.run(["auth", "status", "--hostname", remote.host]);
      return { state: "ready", host: remote.host };
    } catch (error) {
      if (error instanceof GitHubClientError) return { state: error.state, host: remote.host, message: error.message };
      const result = classifyGhError(error as ExecFailure); return { ...result, host: remote.host };
    }
  }

  async list(remote: GitHubRemote, query: PullRequestListQuery, now = new Date().toISOString()): Promise<PullRequestListPage> {
    const offset = query.cursor ?? 0;
    const limit = offset + 31;
    const search = [query.reviewRequested ? "review-requested:@me" : "", query.search.trim()].filter(Boolean).join(" ");
    const args = ["pr", "list", "--repo", repo(remote), "--limit", String(limit), "--state", query.state,
      "--json", "number,title,state,isDraft,author,updatedAt,reviewDecision,statusCheckRollup,url,headRefOid"];
    if (search) args.push("--search", search);
    const parsed = parsePullRequestList((await this.run(args)).stdout).slice(offset);
    return { items: parsed.slice(0, 30), nextCursor: parsed.length > 30 ? offset + 30 : null, fetchedAt: now };
  }

  async detail(remote: GitHubRemote, prNumber: number): Promise<PullRequestDetail> {
    const fields = "number,title,state,isDraft,author,updatedAt,reviewDecision,statusCheckRollup,url,headRefOid,body,labels,baseRefName,headRefName,commits,reviews,comments,files";
    let raw: Record<string, unknown>;
    try { raw = record(JSON.parse((await this.run(["pr", "view", String(prNumber), "--repo", repo(remote), "--json", fields])).stdout), "PR detail"); }
    catch (error) {
      if (/not found|could not resolve/i.test(String((error as Error).message))) throw new Error("PR이 삭제되었거나 더 이상 접근할 수 없습니다.");
      throw error;
    }
    const base = parsePullRequestList(JSON.stringify([raw]))[0];
    const reviews: PullRequestReview[] = array(raw.reviews ?? [], "reviews").map((value) => {
      const item = record(value, "review"); return { id: String(item.id), author: author(item.author), body: String(item.body ?? ""), state: String(item.state), submittedAt: item.submittedAt ? String(item.submittedAt) : null, url: item.url ? String(item.url) : null };
    });
    const comments: PullRequestTimelineItem[] = array(raw.comments ?? [], "comments").map((value) => {
      const item = record(value, "comment"); return { kind: "comment", id: String(item.id), author: author(item.author), body: String(item.body ?? ""), createdAt: String(item.createdAt), updatedAt: String(item.updatedAt), url: String(item.url) };
    });
    let inline: PullRequestTimelineItem[] = [];
    try { inline = this.parseInlineComments((await this.run(["api", `repos/${remote.owner}/${remote.repository}/pulls/${prNumber}/comments`, "--hostname", remote.host, "--paginate", "--slurp"])).stdout); } catch { /* detail remains useful without inline comments */ }
    const checks: PullRequestCheck[] = array(raw.statusCheckRollup ?? [], "checks").map((value) => {
      const item = record(value, "check"); return { name: String(item.name ?? item.context ?? "Check"), state: String(item.status ?? "UNKNOWN"), conclusion: item.conclusion ? String(item.conclusion) : null, detailsUrl: item.detailsUrl ? String(item.detailsUrl) : null };
    });
    const files: PullRequestFile[] = array(raw.files ?? [], "files").map((value) => { const item = record(value, "file"); return { path: String(item.path), additions: Number(item.additions ?? 0), deletions: Number(item.deletions ?? 0), changeType: String(item.changeType ?? "MODIFIED") }; });
    return { ...base, body: String(raw.body ?? ""), authorDetail: author(raw.author), labels: array(raw.labels ?? [], "labels").map((v) => String(record(v, "label").name)), baseRefName: String(raw.baseRefName), headRefName: String(raw.headRefName), commits: array(raw.commits ?? [], "commits").map((v) => { const c = record(v, "commit"); return { oid: String(c.oid), message: String(c.messageHeadline ?? c.message ?? ""), committedAt: String(c.committedDate ?? c.committedAt ?? "") }; }), timeline: [...comments, ...reviews.map((review) => ({ kind: "review" as const, ...review })), ...inline].sort((a, b) => String("createdAt" in a ? a.createdAt : a.submittedAt).localeCompare(String("createdAt" in b ? b.createdAt : b.submittedAt))), files, checks };
  }

  private parseInlineComments(json: string): PullRequestTimelineItem[] {
    const parsed = array(JSON.parse(json), "inline comments");
    const values = parsed.length > 0 && Array.isArray(parsed[0]) ? parsed.flatMap((page) => array(page, "inline comment page")) : parsed;
    return values.map((value) => { const item = record(value, "inline comment"); const result: PullRequestInlineComment = { id: String(item.id), author: { login: String(record(item.user, "user").login) }, body: String(item.body ?? ""), createdAt: String(item.created_at), updatedAt: String(item.updated_at), url: String(item.html_url), path: String(item.path), line: typeof item.line === "number" ? item.line : null, originalLine: typeof item.original_line === "number" ? item.original_line : null, side: item.side === "LEFT" || item.side === "RIGHT" ? item.side : null, inReplyToId: item.in_reply_to_id ? String(item.in_reply_to_id) : null }; return { kind: "inline", ...result }; });
  }

  async hasCurrentUserReviewSince(remote: GitHubRemote, prNumber: number, since: string): Promise<boolean> {
    const user = record(JSON.parse((await this.run(["api", "user", "--hostname", remote.host])).stdout), "viewer");
    const login = String(user.login);
    const detail = await this.detail(remote, prNumber);
    return detail.timeline.some((item) => item.kind === "review" && item.author.login === login && item.submittedAt !== null && item.submittedAt >= since);
  }

  async diff(remote: GitHubRemote, prNumber: number): Promise<PullRequestDiffFile[]> {
    const output = (await this.run(["pr", "diff", String(prNumber), "--repo", repo(remote), "--patch"])).stdout;
    const bounded = Buffer.from(output).subarray(0, MAX_DIFF_BYTES).toString("utf8");
    const chunks = bounded.split(/(?=^diff --git )/m).filter(Boolean);
    return chunks.map((patch, index) => ({ path: /^diff --git a\/.+ b\/(.+)$/m.exec(patch)?.[1] ?? `file-${index + 1}`, patch, truncated: Buffer.byteLength(output) > MAX_DIFF_BYTES && index === chunks.length - 1 }));
  }

  async addComment(remote: GitHubRemote, prNumber: number, body: string): Promise<void> {
    await this.run(["api", "--hostname", remote.host, "--method", "POST", `repos/${remote.owner}/${remote.repository}/issues/${prNumber}/comments`, "--input", "-"], { input: JSON.stringify({ body }) });
  }
  async replyInline(remote: GitHubRemote, prNumber: number, commentId: string, body: string): Promise<void> {
    await this.run(["api", "--hostname", remote.host, "--method", "POST", `repos/${remote.owner}/${remote.repository}/pulls/${prNumber}/comments/${commentId}/replies`, "--input", "-"], { input: JSON.stringify({ body }) });
  }
}
