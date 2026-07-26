import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PullRequestListItem, PullRequestListPage } from "@shared/github-types";
import { PullRequestPanel } from "./PullRequestPanel";

const item = (number: number, title: string): PullRequestListItem => ({ number, title, state: "OPEN", isDraft: false, author: "octo", updatedAt: "2026-07-27T00:00:00Z", reviewDecision: null, checksState: "none", url: "https://example.test", headRefOid: "a".repeat(40) });
const page = (items: PullRequestListItem[]): PullRequestListPage => ({ items, nextCursor: null, fetchedAt: "2026-07-27T00:00:00Z" });

function github(list: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, "multiCliWork", { configurable: true, value: { github: {
    remotes: vi.fn().mockResolvedValue([{ name: "origin", url: "", host: "github.com", owner: "a", repository: "b" }]),
    status: vi.fn().mockResolvedValue({ state: "ready", host: "github.com" }), list,
  } } });
}

describe("PullRequestPanel", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("starts with Open, debounces typing, and flushes search with Enter", async () => {
    const list = vi.fn().mockResolvedValue(page([item(1, "Initial")]));
    github(list);
    render(<PullRequestPanel hidden={false} projectId="p" onOpen={vi.fn()}/>);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    expect(list.mock.calls[0][2]).toMatchObject({ state: "open", search: "" });

    fireEvent.change(screen.getByLabelText("PR 검색"), { target: { value: "bug" } });
    expect(list).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(list.mock.calls[1][2]).toMatchObject({ search: "bug" });

    fireEvent.change(screen.getByLabelText("PR 검색"), { target: { value: "urgent" } });
    fireEvent.submit(screen.getByLabelText("PR 검색").closest("form")!);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(list.mock.calls[2][2]).toMatchObject({ search: "urgent", refresh: true });
  });

  it("ignores a late response from the previous filter", async () => {
    let resolveOpen!: (value: PullRequestListPage) => void;
    let resolveClosed!: (value: PullRequestListPage) => void;
    const list = vi.fn()
      .mockImplementationOnce(() => new Promise<PullRequestListPage>((resolve) => { resolveOpen = resolve; }))
      .mockImplementationOnce(() => new Promise<PullRequestListPage>((resolve) => { resolveClosed = resolve; }));
    github(list);
    render(<PullRequestPanel hidden={false} projectId="p" onOpen={vi.fn()}/>);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("PR 상태"), { target: { value: "closed" } });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    resolveClosed(page([item(2, "Newest")]));
    await screen.findByText("Newest");
    resolveOpen(page([item(1, "Stale")]));
    await Promise.resolve();
    expect(screen.queryByText("Stale")).not.toBeInTheDocument();
  });
});
