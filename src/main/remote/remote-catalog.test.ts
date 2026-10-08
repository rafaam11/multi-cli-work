// @vitest-environment node

import { describe, expect, it } from "vitest";
import { buildRemoteCatalog, existingWorktrees } from "./remote-catalog";

const project = (id: string, overrides: Partial<{ displayName: string | null; rootPath: string; hidden: boolean; order: number | null }> = {}) => ({
  id,
  displayName: id,
  rootPath: `C:\\dev\\${id}`,
  hidden: false,
  order: null,
  ...overrides,
});

const agent = (id: string, label: string, available = true) => ({ id, label, available });

describe("buildRemoteCatalog", () => {
  it("lists visible folders in their saved order, then by name", () => {
    const catalog = buildRemoteCatalog(
      [
        project("p-zeta", { displayName: "제타" }),
        project("p-second", { displayName: "둘째", order: 1 }),
        project("p-hidden", { displayName: "숨김", hidden: true, order: 0 }),
        project("p-alpha", { displayName: "가나" }),
        project("p-first", { displayName: "첫째", order: 0 }),
      ],
      [],
    );
    expect(catalog.projects).toEqual([
      { id: "p-first", name: "첫째", worktrees: [] },
      { id: "p-second", name: "둘째", worktrees: [] },
      { id: "p-alpha", name: "가나", worktrees: [] },
      { id: "p-zeta", name: "제타", worktrees: [] },
    ]);
  });

  it("names a folder without a display name after its directory", () => {
    const catalog = buildRemoteCatalog(
      [
        project("win", { displayName: null, rootPath: "C:\\dev\\multi-cli-work\\" }),
        project("posix", { displayName: null, rootPath: "/home/u/atlas" }),
      ],
      [],
    );
    expect(catalog.projects.map((entry) => entry.name).sort()).toEqual(["atlas", "multi-cli-work"]);
  });

  it("lists each folder's working worktrees, oldest first, and none for a hidden folder", () => {
    const worktree = (id: string, projectId: string, branch: string, createdAt: string) => ({ id, projectId, branch, createdAt });
    const catalog = buildRemoteCatalog(
      [project("p1"), project("p-hidden", { hidden: true })],
      [],
      [
        worktree("w-new", "p1", "feat/new", "2026-10-02T00:00:00.000Z"),
        worktree("w-old", "p1", "feat/old", "2026-10-01T00:00:00.000Z"),
        worktree("w-bot", "p1", "dependabot/npm/x", "2026-10-03T00:00:00.000Z"),
        worktree("w-hidden", "p-hidden", "feat/h", "2026-10-01T00:00:00.000Z"),
      ],
    );
    expect(catalog.projects).toEqual([
      {
        id: "p1",
        name: "p1",
        worktrees: [
          { id: "w-old", branch: "feat/old" },
          { id: "w-new", branch: "feat/new" },
        ],
      },
    ]);
  });

  it("drops worktrees whose folder is gone from disk", async () => {
    const kept = await existingWorktrees(
      [
        { id: "w1", path: "C:\\dev\\a" },
        { id: "w2", path: "C:\\dev\\gone" },
      ],
      async (path) => !path.endsWith("gone"),
    );
    expect(kept.map((worktree) => worktree.id)).toEqual(["w1"]);
  });

  it("offers only the agents this host can actually run", () => {
    const catalog = buildRemoteCatalog([], [agent("claude", "Claude"), agent("codex", "Codex", false), agent("powershell", "PowerShell")]);
    expect(catalog.agents).toEqual([
      { id: "claude", label: "Claude" },
      { id: "powershell", label: "PowerShell" },
    ]);
  });
});
