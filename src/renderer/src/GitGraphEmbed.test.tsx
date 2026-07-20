import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitGraphCommit } from "@shared/api-types";
import { GitGraphEmbed } from "./GitGraphEmbed";

const first: GitGraphCommit = { hash: "a".repeat(40), parents: ["b".repeat(40)], subject: "첫 커밋", authorName: "홍길동", authoredAt: "2026-01-01T00:00:00Z", refs: [{ name: "main", fullName: "refs/heads/main", kind: "local" }] };
const second: GitGraphCommit = { hash: "b".repeat(40), parents: [], subject: "루트", authorName: "Kim", authoredAt: "2025-12-31T00:00:00Z", refs: [] };

describe("GitGraphEmbed", () => {
  const list = vi.fn();
  const commitDetails = vi.fn();
  const createBranch = vi.fn();
  beforeEach(() => {
    list.mockReset().mockResolvedValue({ commits: [first, second], offset: 0, limit: 200, hasMore: false });
    commitDetails.mockReset().mockImplementation(async (_target, hash) => ({ ...([first, second].find((commit) => commit.hash === hash) ?? first), message: "전체 메시지", authorEmail: "a@example.com", committerName: "Committer", committerEmail: "c@example.com", committedAt: "2026-01-01T00:00:00Z", files: [] }));
    createBranch.mockReset().mockResolvedValue(undefined);
    Object.assign(window, { multiCliWork: { gitGraph: { list, commitDetails, fileDiff: vi.fn(), createBranch, createTag: vi.fn(), cherryPick: vi.fn(), revert: vi.fn() }, git: { checkout: vi.fn() }, clipboard: { writeText: vi.fn() } } });
  });

  it("loads commits and moves or closes the inline details", async () => {
    render(<GitGraphEmbed target={{ kind: "project", id: "p1" }} targetLabel="Repo" />);
    expect(await screen.findByText("첫 커밋")).toBeInTheDocument();
    fireEvent.click(screen.getByText("첫 커밋"));
    expect(await screen.findByRole("region", { name: "첫 커밋 커밋 상세" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("루트"));
    expect(await screen.findByRole("region", { name: "루트 커밋 상세" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "첫 커밋 커밋 상세" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("루트"));
    expect(screen.queryByRole("region", { name: "루트 커밋 상세" })).not.toBeInTheDocument();
  });

  it("uses an inline dialog and checks out a new branch by default", async () => {
    render(<GitGraphEmbed target={{ kind: "project", id: "p1" }} targetLabel="Repo" />);
    const row = (await screen.findByText("첫 커밋")).closest("button")!;
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "브랜치 만들기" }));
    const dialog = screen.getByRole("dialog", { name: "커밋에서 브랜치 만들기" });
    fireEvent.change(screen.getByLabelText("브랜치 이름"), { target: { value: "feature/test" } });
    expect(screen.getByRole("checkbox", { name: "생성 후 checkout" })).toBeChecked();
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);
    await waitFor(() => expect(createBranch).toHaveBeenCalledWith({ kind: "project", id: "p1" }, first.hash, "feature/test", true));
  });

  it("loads the next 200 commits and renders API errors", async () => {
    list.mockReset()
      .mockResolvedValueOnce({ commits: [first], offset: 0, limit: 200, hasMore: true })
      .mockResolvedValueOnce({ commits: [second], offset: 1, limit: 200, hasMore: false });
    const { unmount } = render(<GitGraphEmbed target={{ kind: "project", id: "p1" }} targetLabel="Repo" />);
    fireEvent.click(await screen.findByRole("button", { name: "더 불러오기" }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith({ kind: "project", id: "p1" }, { offset: 1, limit: 200 }));
    unmount();

    list.mockReset().mockRejectedValue(new Error("log failed"));
    const broken = render(<GitGraphEmbed target={{ kind: "project", id: "p2" }} targetLabel="Broken" />);
    await waitFor(() => expect(broken.container.querySelector('[role="alert"]')).toHaveTextContent("log failed"));
  });
});
