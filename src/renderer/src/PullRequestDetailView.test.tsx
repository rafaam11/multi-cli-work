import type { MultiCliWorkApi } from "@shared/api-types";
import type {
  ActivePullRequestReview,
  PullRequestDetail,
  PullRequestReviewAnnotation,
} from "@shared/github-types";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PullRequestDetailView } from "./PullRequestDetailView";

const HEAD = "a".repeat(40);
const detail: PullRequestDetail = {
  number: 12, title: "Fix", state: "OPEN", isDraft: false, author: "octo",
  updatedAt: "2026-07-30T00:00:00Z", reviewDecision: null, checksState: "none",
  url: "https://github.com/a/b/pull/12", headRefOid: HEAD, body: "", authorDetail: { login: "octo" },
  labels: [], baseRefName: "main", headRefName: "fix", commits: [], timeline: [],
  files: [{ path: "src/a.ts", additions: 1, deletions: 1, changeType: "MODIFIED" }], checks: [],
};
const diff = [{ path: "src/a.ts", patch: "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-old\n+new\n", truncated: false }];
const review = (headSha = HEAD): ActivePullRequestReview => ({
  id: "review-1", projectId: "project", remoteName: "origin", pullRequestNumber: 12,
  headSha, worktreeId: "worktree-1", sessionId: "session-review", agent: "codex",
  promptDelivered: true, startedAt: "2026-07-30T00:00:00Z", updatedAt: "2026-07-30T00:00:00Z",
});
const annotation = (overrides: Partial<PullRequestReviewAnnotation> = {}): PullRequestReviewAnnotation => ({
  id: "note-1", headSha: HEAD, path: "src/a.ts", side: "RIGHT", line: 1, lineText: "new",
  body: "고쳐 주세요", status: "draft", createdAt: "2026-07-30T00:00:00Z",
  updatedAt: "2026-07-30T00:00:00Z", sentAt: null, ...overrides,
});

function api(options: { reviews?: ActivePullRequestReview[]; notes?: PullRequestReviewAnnotation[] } = {}) {
  const upsertAnnotation = vi.fn(async (_project: string, _remote: string, _pr: number, input: Parameters<MultiCliWorkApi["github"]["upsertAnnotation"]>[3]) =>
    annotation({ ...input, id: input.id ?? "note-created", status: "draft", sentAt: null }));
  const github = {
    detail: vi.fn().mockResolvedValue(detail), diff: vi.fn().mockResolvedValue(diff),
    activeReviews: vi.fn().mockResolvedValue(options.reviews ?? []),
    annotations: vi.fn().mockResolvedValue({ annotations: options.notes ?? [] }),
    upsertAnnotation, deleteAnnotation: vi.fn().mockResolvedValue(undefined),
    sendDraftAnnotations: vi.fn().mockResolvedValue({ sent: 1, annotations: (options.notes ?? []).map((note) => ({ ...note, status: "sent", sentAt: "now" })) }),
    startReview: vi.fn(), refillReview: vi.fn(), finishReview: vi.fn(),
    comment: vi.fn(), reply: vi.fn(),
  };
  const value = {
    github,
    shell: { openExternal: vi.fn() },
    clipboard: { writeText: vi.fn(), readText: vi.fn() },
  } as unknown as MultiCliWorkApi;
  return { value, github };
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("PullRequestDetailView private line notes", () => {
  it("saves from a RIGHT gutter editor without a review and explains why send is blocked", async () => {
    const harness = api();
    window.multiCliWork = harness.value;
    render(<PullRequestDetailView projectId="project" remoteName="origin" prNumber={12} onReviewOpened={vi.fn()} onWorkspaceChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole("tab", { name: "변경 파일 (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: "src/a.ts RIGHT 1줄 line note 추가" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Line note 본문" }), { target: { value: "이 줄을 안전하게 고쳐 주세요" } });
    fireEvent.click(screen.getByRole("button", { name: "Draft 저장" }));

    await waitFor(() => expect(harness.github.upsertAnnotation).toHaveBeenCalledWith(
      "project", "origin", 12, expect.objectContaining({ headSha: HEAD, path: "src/a.ts", side: "RIGHT", line: 1, lineText: "new" }),
    ));
    expect(screen.getByText("Draft 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Draft 전송/ })).toBeDisabled();
    expect(screen.getByText(/리뷰 먼저 시작/)).toBeInTheDocument();
  });

  it("keeps both review buttons disabled while a single start is pending", async () => {
    const harness = api();
    let resolve!: (value: unknown) => void;
    harness.github.startReview.mockReturnValue(new Promise((next) => { resolve = next; }));
    window.multiCliWork = harness.value;
    render(<PullRequestDetailView projectId="project" remoteName="origin" prNumber={12} onReviewOpened={vi.fn()} onWorkspaceChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Claude Code 리뷰" }));

    expect(screen.getByRole("button", { name: "리뷰 시작 중…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Codex 리뷰" })).toBeDisabled();
    await act(async () => resolve({ review: review(), prompt: "", session: { id: "session-review" } }));
  });

  it("shows stale review notes as read-only in the accessible history drawer", async () => {
    const oldHead = "b".repeat(40);
    const harness = api({
      reviews: [review(oldHead)],
      notes: [annotation({ headSha: oldHead, status: "sent", sentAt: "2026-07-30T01:00:00Z" })],
    });
    window.multiCliWork = harness.value;
    render(<PullRequestDetailView projectId="project" remoteName="origin" prNumber={12} onReviewOpened={vi.fn()} onWorkspaceChanged={vi.fn()} />);

    expect(await screen.findByRole("status")).toHaveTextContent("읽기 전용");
    fireEvent.click(screen.getByRole("tab", { name: "변경 파일 (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: "이력 1" }));
    const drawer = screen.getByRole("dialog", { name: "PR line notes 이력" });
    expect(drawer).toHaveTextContent("이전 head · 읽기 전용");
    expect(screen.queryByRole("button", { name: "삭제" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "재전송" })).not.toBeInTheDocument();
  });

  it("offers accessible delete and resend actions for the current head history", async () => {
    const sent = annotation({ status: "sent", sentAt: "2026-07-30T01:00:00Z" });
    const harness = api({ notes: [sent] });
    window.multiCliWork = harness.value;
    render(<PullRequestDetailView projectId="project" remoteName="origin" prNumber={12} onReviewOpened={vi.fn()} onWorkspaceChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole("tab", { name: "변경 파일 (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: "이력 1" }));

    expect(screen.getByRole("button", { name: "재전송" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "삭제" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "재전송" }));
    await waitFor(() => expect(harness.github.upsertAnnotation).toHaveBeenCalledWith(
      "project", "origin", 12, expect.objectContaining({ id: sent.id, headSha: HEAD }),
    ));
  });

  it("preserves the visible draft and error when PTY delivery fails", async () => {
    const note = annotation();
    const harness = api({ reviews: [review()], notes: [note] });
    harness.github.sendDraftAnnotations.mockRejectedValueOnce(new Error("PTY unavailable"));
    window.multiCliWork = harness.value;
    render(<PullRequestDetailView projectId="project" remoteName="origin" prNumber={12} onReviewOpened={vi.fn()} onWorkspaceChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole("tab", { name: "변경 파일 (1)" }));
    fireEvent.click(await screen.findByRole("button", { name: /Draft 전송/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("PTY unavailable");
    expect(screen.getByText("Draft 1")).toBeInTheDocument();
  });
});
