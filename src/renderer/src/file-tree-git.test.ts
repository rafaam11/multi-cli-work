import type { GitPanelData } from "@shared/api-types";
import { describe, expect, it } from "vitest";
import { buildGitOverlay, EMPTY_GIT_OVERLAY, gitRowClass } from "./file-tree-git";

function panelData(overrides: Partial<GitPanelData>): GitPanelData {
  return {
    isRepo: true,
    currentBranch: "main",
    upstream: null,
    ahead: null,
    behind: null,
    branches: ["main"],
    changes: [],
    ignored: [],
    ...overrides,
  };
}

describe("buildGitOverlay", () => {
  it("marks every folder on the way down to a change", () => {
    const overlay = buildGitOverlay(panelData({ changes: [{ path: "src/main/ipc.ts", status: "M" }] }));

    expect(overlay.statusByPath.get("src/main/ipc.ts")).toBe("M");
    expect([...overlay.changedDirs].sort()).toEqual(["src", "src/main"]);
  });

  it("leaves a file at the root out of the folder set", () => {
    const overlay = buildGitOverlay(panelData({ changes: [{ path: "readme.md", status: "?" }] }));

    expect(overlay.changedDirs.size).toBe(0);
  });

  it("has nothing to say about a folder that is not a repository", () => {
    expect(buildGitOverlay(null)).toBe(EMPTY_GIT_OVERLAY);
    expect(buildGitOverlay(panelData({ isRepo: false, changes: [{ path: "a.ts", status: "M" }] }))).toBe(
      EMPTY_GIT_OVERLAY,
    );
  });
});

describe("gitRowClass", () => {
  const overlay = buildGitOverlay(
    panelData({
      changes: [
        { path: "src/App.tsx", status: "M" },
        { path: "src/new.ts", status: "?" },
        { path: "staged.ts", status: "A" },
        { path: "gone.ts", status: "D" },
        { path: "moved.ts", status: "R", renamedFrom: "old.ts" },
        { path: "clash.ts", status: "U" },
      ],
      ignored: ["node_modules", "secrets.env"],
    }),
  );

  it("names the status of a changed file", () => {
    expect(gitRowClass(overlay, "src/App.tsx", "file")).toBe("git-modified");
    expect(gitRowClass(overlay, "src/new.ts", "file")).toBe("git-untracked");
    expect(gitRowClass(overlay, "staged.ts", "file")).toBe("git-added");
    expect(gitRowClass(overlay, "gone.ts", "file")).toBe("git-deleted");
    expect(gitRowClass(overlay, "moved.ts", "file")).toBe("git-modified");
    expect(gitRowClass(overlay, "clash.ts", "file")).toBe("git-conflict");
  });

  it("marks a folder holding a change without claiming the change is the folder's", () => {
    expect(gitRowClass(overlay, "src", "directory")).toBe("git-dirty");
    expect(gitRowClass(overlay, "docs", "directory")).toBeNull();
  });

  it("dims everything inside an ignored folder, and the folder itself", () => {
    expect(gitRowClass(overlay, "node_modules", "directory")).toBe("git-ignored");
    expect(gitRowClass(overlay, "node_modules/react/index.js", "file")).toBe("git-ignored");
    expect(gitRowClass(overlay, "secrets.env", "file")).toBe("git-ignored");
  });

  it("does not mistake a sibling for a path inside an ignored folder", () => {
    expect(gitRowClass(overlay, "node_modules_backup", "directory")).toBeNull();
  });

  it("says nothing about an untouched file", () => {
    expect(gitRowClass(overlay, "src/index.css", "file")).toBeNull();
  });
});
