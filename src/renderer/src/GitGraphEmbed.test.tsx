import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitGraphCommit } from "@shared/api-types";
import { GitGraphEmbed } from "./GitGraphEmbed";

// jsdom ships no ResizeObserver, and the graph measures its viewport and expanded block with one.
Object.assign(globalThis, {
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
});

const first: GitGraphCommit = { hash: "a".repeat(40), parents: ["b".repeat(40)], subject: "첫 커밋", authorName: "홍길동", authoredAt: "2026-01-01T00:00:00Z", refs: [{ name: "main", fullName: "refs/heads/main", kind: "local" }] };
const second: GitGraphCommit = { hash: "b".repeat(40), parents: [], subject: "루트", authorName: "Kim", authoredAt: "2025-12-31T00:00:00Z", refs: [] };

const target = { kind: "project", id: "p1" } as const;
const row = (subject: string) => screen.getByText(subject).closest('[role="button"]')!;

afterEach(cleanup);

describe("GitGraphEmbed", () => {
  const list = vi.fn();
  const commitDetails = vi.fn();
  const createBranch = vi.fn();
  const panelData = vi.fn();

  beforeEach(() => {
    list.mockReset().mockResolvedValue({ commits: [first, second], offset: 0, limit: 200, hasMore: false });
    commitDetails.mockReset().mockImplementation(async (_target, hash) => ({ ...([first, second].find((commit) => commit.hash === hash) ?? first), message: "전체 메시지", authorEmail: "a@example.com", committerName: "Committer", committerEmail: "c@example.com", committedAt: "2026-01-01T00:00:00Z", files: [] }));
    createBranch.mockReset().mockResolvedValue(undefined);
    panelData.mockReset().mockResolvedValue({ isRepo: true, currentBranch: "main", upstream: null, ahead: null, behind: null, branches: ["main"], changes: [] });
    Object.assign(window, { multiCliWork: { gitGraph: { list, commitDetails, fileDiff: vi.fn(), createBranch, createTag: vi.fn(), cherryPick: vi.fn(), revert: vi.fn() }, git: { checkout: vi.fn(), panelData }, clipboard: { writeText: vi.fn() } } });
  });

  it("loads commits and moves or closes the inline details", async () => {
    render(<GitGraphEmbed target={target} targetLabel="Repo" />);
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
    render(<GitGraphEmbed target={target} targetLabel="Repo" />);
    await screen.findByText("첫 커밋");
    fireEvent.contextMenu(row("첫 커밋"), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole("menuitem", { name: "브랜치 만들기" }));

    const dialog = screen.getByRole("dialog", { name: "커밋에서 브랜치 만들기" });
    fireEvent.change(screen.getByLabelText("브랜치 이름"), { target: { value: "feature/test" } });
    expect(screen.getByRole("checkbox", { name: "생성 후 checkout" })).toBeChecked();
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);

    await waitFor(() => expect(createBranch).toHaveBeenCalledWith(target, first.hash, "feature/test", true));
  });

  it("appends the next page when the scroller reaches the end", async () => {
    list.mockReset()
      .mockResolvedValueOnce({ commits: [first], offset: 0, limit: 200, hasMore: true })
      .mockResolvedValueOnce({ commits: [second], offset: 1, limit: 200, hasMore: false });
    const { container } = render(<GitGraphEmbed target={target} targetLabel="Repo" />);
    await screen.findByText("첫 커밋");

    fireEvent.scroll(container.querySelector(".native-graph-list")!);

    await waitFor(() => expect(list).toHaveBeenLastCalledWith(target, { offset: 1, limit: 200 }));
    expect(await screen.findByText("루트")).toBeInTheDocument();
  });

  it("does not request the same page twice when scroll events pile up", async () => {
    list.mockReset()
      .mockResolvedValueOnce({ commits: [first], offset: 0, limit: 200, hasMore: true })
      .mockResolvedValue({ commits: [second], offset: 1, limit: 200, hasMore: false });
    const { container } = render(<GitGraphEmbed target={target} targetLabel="Repo" />);
    await screen.findByText("첫 커밋");

    const scroller = container.querySelector(".native-graph-list")!;
    fireEvent.scroll(scroller);
    fireEvent.scroll(scroller);
    fireEvent.scroll(scroller);

    await waitFor(() => expect(screen.getByText("루트")).toBeInTheDocument());
    // Two calls total: the initial page and exactly one append.
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("highlights search matches without dropping rows from the graph", async () => {
    render(<GitGraphEmbed target={target} targetLabel="Repo" />);
    await screen.findByText("첫 커밋");

    fireEvent.change(screen.getByLabelText("커밋 검색"), { target: { value: "루트" } });

    // Filtering would break the parent links the graph is drawn from, so both rows must survive.
    expect(screen.getByText("첫 커밋")).toBeInTheDocument();
    expect(screen.getByText("루트")).toBeInTheDocument();
    expect(screen.getByText("1/1")).toBeInTheDocument();
    expect(row("루트").className).toContain("active-match");
  });

  it("shows a pending-changes row only while the working tree is dirty", async () => {
    panelData.mockResolvedValue({ isRepo: true, currentBranch: "main", upstream: null, ahead: null, behind: null, branches: ["main"], changes: [{ path: "a.ts", status: "M" }, { path: "b.ts", status: "?" }] });
    render(<GitGraphEmbed target={target} targetLabel="Repo" />);

    expect(await screen.findByText("미커밋 변경 2건")).toBeInTheDocument();
  });

  it("renders API errors", async () => {
    list.mockReset().mockRejectedValue(new Error("log failed"));
    const { container } = render(<GitGraphEmbed target={target} targetLabel="Broken" />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toHaveTextContent("log failed"));
  });
});
