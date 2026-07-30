import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivePullRequestReview, PullRequestDetail } from "../../shared/github-types";
import { readReviewRegistry, upsertReview } from "./review-registry";
import { PullRequestReviewService, pullRequestAnnotationsPrompt, pullRequestReviewPrompt } from "./review-service";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

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

describe("private PR annotations", () => {
  const HEAD = "a".repeat(40);
  const remote = { name: "origin", url: "", host: "github.com", owner: "a", repository: "b" };
  const patch = "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
  const detail = (headSha = "a".repeat(40)): PullRequestDetail => ({
    number: 12, title: "Fix", state: "OPEN", isDraft: false, author: "octo",
    updatedAt: "2026-07-30T00:00:00Z", reviewDecision: null, checksState: "none",
    url: "https://github.com/a/b/pull/12", headRefOid: headSha, body: "", authorDetail: { login: "octo" },
    labels: [], baseRefName: "main", headRefName: "fix", commits: [], timeline: [],
    files: [{ path: "src/a.ts", additions: 1, deletions: 1, changeType: "MODIFIED" }], checks: [],
  });

  async function fixture(headSha = "a".repeat(40)) {
    const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-pr-notes-"));
    roots.push(root);
    const registryPath = path.join(root, "reviews.json");
    let sequence = 0;
    const writeSession = vi.fn().mockResolvedValue(undefined);
    const client = {
      detail: vi.fn().mockResolvedValue(detail(headSha)),
      diff: vi.fn().mockResolvedValue([{ path: "src/a.ts", patch, truncated: false }]),
      hasCurrentUserReviewSince: vi.fn().mockResolvedValue(true),
    };
    const session = { id: "session-review" } as never;
    const service = new PullRequestReviewService({
      registryPath,
      getProject: vi.fn().mockResolvedValue({ id: "project", rootPath: root }),
      listRemotes: vi.fn().mockResolvedValue([remote]),
      createSession: vi.fn(), attachSession: vi.fn().mockResolvedValue(undefined), writeSession,
      removeSession: vi.fn(), listSessions: () => [session],
      removeWorktree: vi.fn().mockResolvedValue({ removed: true }),
      idFactory: () => `note-${++sequence}`,
      now: () => `2026-07-30T00:00:0${sequence}.000Z`,
      client: client as never,
    });
    const review: ActivePullRequestReview = {
      id: "review-1", projectId: "project", remoteName: "origin", pullRequestNumber: 12,
      headSha, worktreeId: "worktree-1", sessionId: "session-review", agent: "codex",
      promptDelivered: true, startedAt: "2026-07-30T00:00:00.000Z", updatedAt: "2026-07-30T00:00:00.000Z",
    };
    const add = () => service.upsertAnnotation("project", "origin", 12, {
      headSha, path: "src/a.ts", side: "RIGHT", line: 1, lineText: "new", body: "이 동작을 고쳐 주세요",
    });
    return { service, client, registryPath, review, add, writeSession };
  }

  it("saves drafts without an active review but blocks sending them", async () => {
    const { service, add } = await fixture();
    const annotation = await add();

    expect(annotation.status).toBe("draft");
    await expect(service.sendDraftAnnotations("project", "origin", 12)).rejects.toThrow("리뷰 먼저 시작");
    await expect(service.listAnnotations("project", "origin", 12)).resolves.toMatchObject({
      annotations: [{ id: annotation.id, status: "draft" }],
    });
  });

  it("rejects root escapes and stale line context before persisting", async () => {
    const { service } = await fixture();
    await expect(service.upsertAnnotation("project", "origin", 12, {
      headSha: HEAD, path: "../secret.ts", side: "RIGHT", line: 1, lineText: "new", body: "fix",
    })).rejects.toThrow(/root|상대경로/);
    await expect(service.upsertAnnotation("project", "origin", 12, {
      headSha: HEAD, path: "src/a.ts", side: "RIGHT", line: 1, lineText: "stale", body: "fix",
    })).rejects.toThrow(/일치하지 않습니다/);
    expect((await service.listAnnotations("project", "origin", 12)).annotations).toEqual([]);
  });

  it("sends all drafts once to the review PTY and marks them sent only after write succeeds", async () => {
    const { service, registryPath, review, add, writeSession } = await fixture();
    await upsertReview(review, { registryPath });
    await add();

    const result = await service.sendDraftAnnotations("project", "origin", 12);

    expect(result.sent).toBe(1);
    expect(result.annotations[0]).toMatchObject({ status: "sent", sentAt: expect.any(String) });
    expect(writeSession).toHaveBeenCalledWith("session-review", expect.stringContaining("src/a.ts · RIGHT:1"));
    expect(writeSession.mock.calls[0][1]).toMatch(/\u001b\[201~\r$/);
  });

  it("preserves drafts and the error when PTY write fails", async () => {
    const { service, registryPath, review, add, writeSession } = await fixture();
    await upsertReview(review, { registryPath });
    await add();
    writeSession.mockRejectedValueOnce(new Error("PTY unavailable"));

    await expect(service.sendDraftAnnotations("project", "origin", 12)).rejects.toThrow("PTY unavailable");
    expect((await service.listAnnotations("project", "origin", 12)).annotations[0].status).toBe("draft");
  });

  it("rejects stale-head sends and removes that review head's notes on finish", async () => {
    const { service, client, registryPath, review, add } = await fixture();
    await upsertReview(review, { registryPath });
    await add();
    client.detail.mockResolvedValueOnce(detail("b".repeat(40)));
    await expect(service.sendDraftAnnotations("project", "origin", 12)).rejects.toThrow("HEAD가 변경");

    await service.finish(review.id, { allowUnverifiedReview: true, discardChanges: false });

    const registry = (await readReviewRegistry({ registryPath })).registry;
    expect(registry.reviews).toEqual({});
    expect(Object.values(registry.annotationSets)[0].items).toEqual({});
  });

  it("builds a private prompt that forbids publishing to GitHub", () => {
    const prompt = pullRequestAnnotationsPrompt(remote, 12, "a".repeat(40), [{
      id: "n", headSha: "a".repeat(40), path: "src/a.ts", side: "RIGHT", line: 1,
      lineText: "new", body: "fix", status: "draft", createdAt: "now", updatedAt: "now", sentAt: null,
    }]);
    expect(prompt).toContain("GitHub comment 또는 review로 게시하지 마세요");
    expect(prompt).toContain("코드: new");
  });
});
