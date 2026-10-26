import { describe, expect, it } from "vitest";
import type { TerminalSessionView } from "@shared/api-types";
import type { SharedProject } from "@shared/project-types";
import type { WorkProject } from "@shared/work-project-types";
import type { GitWorkspaceView, SharedWorktree } from "@shared/worktree-types";
import { buildLayout } from "../grid-layouts";
import { buildRemoteMirror, type RemoteMirrorSources } from "./remote-mirror";

const project = (id: string, rootPath: string) => ({ id, rootPath, displayName: null }) as SharedProject;

const session = (id: string, projectId: string, createdAt: string, worktreeId?: string) =>
  ({ id, projectId, createdAt, ...(worktreeId ? { worktreeId } : {}) }) as TerminalSessionView;

const worktree = (id: string, projectId: string, branch: string): SharedWorktree => ({
  id,
  projectId,
  path: `C:/wt/${id}`,
  branch,
  createdAt: "",
  updatedAt: "",
});

const workspace = (overrides: Partial<GitWorkspaceView>): GitWorkspaceView => ({
  workspaceKey: "",
  kind: "worktree",
  projectId: "p1",
  worktreeId: null,
  path: "",
  branch: null,
  head: null,
  changedFileCount: 0,
  availability: "available" as GitWorkspaceView["availability"],
  lockedReason: null,
  prunableReason: null,
  ...overrides,
});

function sources(overrides: Partial<RemoteMirrorSources> = {}): RemoteMirrorSources {
  return {
    sections: [
      { key: "w1", workProject: { id: "w1", name: "연구" } as WorkProject, projects: [project("p1", "D:/dev/app")] },
      { key: "none", workProject: null, projects: [project("p2", "D:/dev/notes")] },
    ],
    sessions: [
      session("s2", "p1", "2026-01-02", "wt-feature"),
      session("s1", "p1", "2026-01-01"),
      session("s3", "p1", "2026-01-03", "wt-bot"),
      session("s4", "p2", "2026-01-04"),
    ],
    worktrees: [
      worktree("wt-feature", "p1", "feature/x"),
      worktree("wt-bot", "p1", "dependabot/npm/x"),
      worktree("wt-review", "p1", "review"),
    ],
    workspaceViews: [
      workspace({ kind: "main", branch: "main", changedFileCount: 3 }),
      workspace({ worktreeId: "wt-feature", branch: "feature/x", changedFileCount: 1 }),
    ],
    activeReviews: [{ worktreeId: "wt-review", pullRequestNumber: 42 }] as unknown as RemoteMirrorSources["activeReviews"],
    projectMembership: { p1: { role: "repo" } },
    missingRootProjectIds: ["p2"],
    documentPanes: [{ id: "doc:readme", label: "README.md" }],
    activeView: "terminal",
    shelfKind: null,
    selectedProjectId: "p1",
    selectedWorktreeId: null,
    layoutId: "auto",
    resolvedView: { layout: buildLayout([1, 1]), slots: ["s1", "doc:readme"], page: 0, pages: 1 },
    focusedPaneId: "s1",
    showsGrid: true,
    zoomedPaneId: null,
    agents: [],
    theme: "dark",
    ...overrides,
  };
}

describe("buildRemoteMirror", () => {
  it("lays the tree out the way the sidebar does", () => {
    const { tree } = buildRemoteMirror(sources());
    expect(tree.map((section) => section.workProject)).toEqual([{ id: "w1", name: "연구" }, null]);
    const [app] = tree[0].folders;
    expect(app).toMatchObject({
      id: "p1",
      name: "app",
      missing: false,
      role: "repo",
      sessionIds: ["s1", "s2", "s3"],
      main: { branch: "main", changedFileCount: 3 },
      // The bot branch is left out of the tree and its session stands at the root.
      rootSessionIds: ["s1", "s3"],
    });
    // Branch order, with the pull request checkout last.
    expect(app.worktrees).toEqual([
      { id: "wt-feature", branch: "feature/x", changedFileCount: 1, sessionIds: ["s2"] },
      { id: "wt-review", branch: "PR #42 · 임시", changedFileCount: 0, sessionIds: [] },
    ]);
    expect(tree[1].folders[0]).toMatchObject({ id: "p2", missing: true, main: null, rootSessionIds: ["s4"] });
  });

  it("describes the grid page with documents told apart from sessions", () => {
    expect(buildRemoteMirror(sources()).view).toEqual({
      place: { kind: "folder", projectId: "p1", worktreeId: null },
      layoutId: "auto",
      columnRows: [1, 1],
      page: 0,
      pages: 1,
      focusedPaneId: "s1",
      zoomedPaneId: null,
      slots: [
        { kind: "session", id: "s1" },
        { kind: "document", id: "doc:readme", label: "README.md" },
      ],
    });
  });

  it("names a shelf as the place and keeps empty slots", () => {
    const view = buildRemoteMirror(
      sources({
        shelfKind: "hidden",
        resolvedView: { layout: buildLayout([2]), slots: [null, "s4"], page: 1, pages: 2 },
      }),
    ).view;
    expect(view.place).toEqual({ kind: "shelf", shelf: "hidden" });
    expect(view.slots).toEqual([null, { kind: "session", id: "s4" }]);
    expect([view.page, view.pages]).toEqual([1, 2]);
  });

  it("shows no grid while the host is on a page that is not one", () => {
    for (const overrides of [{ activeView: "home" as const }, { selectedProjectId: null }]) {
      const view = buildRemoteMirror(sources(overrides)).view;
      expect(view.place).toEqual({ kind: "other" });
      expect(view.slots).toEqual([]);
      expect(view.columnRows).toEqual([]);
    }
  });

  it("shows no grid while the host shows its start page", () => {
    const view = buildRemoteMirror(sources({ showsGrid: false, zoomedPaneId: "s1" })).view;
    expect(view.slots).toEqual([]);
    expect(view.columnRows).toEqual([]);
    expect(view.zoomedPaneId).toBeNull();
  });

  it("draws a slot whose session is gone as empty, as the host does", () => {
    const view = buildRemoteMirror(
      sources({ resolvedView: { layout: buildLayout([1, 1]), slots: ["gone", "s1"], page: 0, pages: 1 } }),
    ).view;
    expect(view.slots).toEqual([null, { kind: "session", id: "s1" }]);
  });

  it("carries the zoom, the theme and the host's session names", () => {
    const mirror = buildRemoteMirror(
      sources({
        zoomedPaneId: "s1",
        theme: "light",
        sessions: [
          { ...session("s1", "p1", "2026-01-01"), kind: "shell" },
          { ...session("s2", "p1", "2026-01-02"), kind: "shell" },
          { ...session("s3", "p1", "2026-01-03"), kind: "shell", name: "빌드" },
        ] as TerminalSessionView[],
        agents: [{ id: "shell", label: "PowerShell" }] as unknown as RemoteMirrorSources["agents"],
      }),
    );
    expect(mirror.view.zoomedPaneId).toBe("s1");
    expect(mirror.theme).toBe("light");
    expect(mirror.labels).toEqual({ s1: "PowerShell 1", s2: "PowerShell 2", s3: "빌드" });
  });
});
