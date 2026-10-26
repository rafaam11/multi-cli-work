import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RemoteMirrorSection, RemoteSessionSummary } from "@shared/remote-types";
import { ProjectTree } from "./ProjectTree";

const TREE: RemoteMirrorSection[] = [
  {
    workProject: { id: "w1", name: "연구" },
    folders: [
      { id: "p1", name: "앱", missing: false, sessionIds: ["s1"], main: null, rootSessionIds: ["s1"], worktrees: [] },
      { id: "p2", name: "문서", missing: false, sessionIds: ["s2"], main: null, rootSessionIds: ["s2"], worktrees: [] },
    ],
  },
  {
    workProject: null,
    folders: [{ id: "p3", name: "옛 폴더", missing: true, sessionIds: [], main: null, rootSessionIds: [], worktrees: [] }],
  },
];

const SESSIONS: RemoteSessionSummary[] = [
  { id: "s1", projectId: "p1", projectName: "앱", kind: "claude", label: "리팩터", status: "awaiting-approval", updatedAt: "1" },
  { id: "s2", projectId: "p2", projectName: "문서", kind: "codex", label: "정리", status: "idle", updatedAt: "1" },
];

function renderTree(overrides: Partial<Parameters<typeof ProjectTree>[0]> = {}) {
  const props = {
    tree: TREE,
    sessions: SESSIONS,
    place: { kind: "folder", projectId: "p1", worktreeId: null } as const,
    onScreenSessionIds: [],
    disabled: false,
    onNewSession: vi.fn(),
    onOpenSession: vi.fn(),
    ...overrides,
  };
  render(<ProjectTree {...props} />);
  return props;
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("ProjectTree", () => {
  it("starts with work projects open and folders closed, and remembers what was unfolded", () => {
    renderTree();
    expect(screen.getByRole("button", { name: "앱" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^리팩터/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "앱 펼치기" }));
    expect(screen.getByRole("button", { name: /^리팩터/ })).toBeInTheDocument();

    cleanup();
    renderTree();
    expect(screen.getByRole("button", { name: /^리팩터/ })).toBeInTheDocument();
  });

  it("unfolds only the folders with sessions that are busy or waiting", () => {
    renderTree();
    fireEvent.click(screen.getByRole("button", { name: "모두" }));
    expect(screen.getByRole("button", { name: /^정리/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "작업중" }));
    expect(screen.getByRole("button", { name: /^리팩터/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^정리/ })).not.toBeInTheDocument();
  });

  it("moves the host to a folder only when it may, and offers no new session where the folder is gone", () => {
    const onSelectFolder = vi.fn();
    const props = renderTree({ onSelectFolder });
    fireEvent.click(screen.getByRole("button", { name: "문서" }));
    expect(onSelectFolder).toHaveBeenCalledWith("p2", null);
    fireEvent.click(screen.getByRole("button", { name: "문서에서 새 세션" }));
    expect(props.onNewSession).toHaveBeenCalledWith("p2", null);
    expect(screen.queryByRole("button", { name: "옛 폴더에서 새 세션" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^정리/ }));
    expect(props.onOpenSession).toHaveBeenCalledWith("s2");
  });
});
