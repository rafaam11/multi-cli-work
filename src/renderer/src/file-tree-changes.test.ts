import type { FileTreeEntry, WorkspaceChangedPaths } from "@shared/file-explorer-types";
import { describe, expect, it } from "vitest";
import { buildChangeOverlay, changeOriginLabel, changeRowClass, EMPTY_CHANGE_OVERLAY } from "./file-tree-changes";

function changed(overrides: Partial<WorkspaceChangedPaths>): WorkspaceChangedPaths {
  return { agentPaths: [], baselineMs: 0, ...overrides };
}

function fileEntry(relativePath: string, mtimeMs: number): FileTreeEntry {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  return { name, relativePath, kind: "file", extension: null, executable: false, mtimeMs };
}

function dirEntry(relativePath: string): FileTreeEntry {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  return { name, relativePath, kind: "directory", extension: null, executable: false, mtimeMs: 0 };
}

describe("buildChangeOverlay", () => {
  it("has nothing to say when there is no changedPaths read yet", () => {
    expect(buildChangeOverlay(null, {})).toBe(EMPTY_CHANGE_OVERLAY);
  });

  it("marks an agent-edited file and rolls the mark up through every ancestor folder", () => {
    const overlay = buildChangeOverlay(
      changed({ agentPaths: [{ relativePath: "src/main/ipc.ts", kind: "file", at: 10 }] }),
      {},
    );

    expect(overlay.originByPath.get("src/main/ipc.ts")).toBe("agent");
    expect([...overlay.changedDirs].sort()).toEqual([
      ["src", "agent"],
      ["src/main", "agent"],
    ]);
  });

  it("marks a file whose mtime is newer than baselineMs as local, when it is not in the agent index", () => {
    const overlay = buildChangeOverlay(changed({ baselineMs: 100 }), {
      "": [fileEntry("newer.ts", 200), fileEntry("older.ts", 50)],
    });

    expect(overlay.originByPath.get("newer.ts")).toBe("local");
    expect(overlay.originByPath.has("older.ts")).toBe(false);
  });

  it("never demotes an agent-edited file to local even if its mtime also moved", () => {
    const overlay = buildChangeOverlay(
      changed({ agentPaths: [{ relativePath: "a.ts", kind: "file", at: 10 }], baselineMs: 0 }),
      { "": [fileEntry("a.ts", 999)] },
    );

    expect(overlay.originByPath.get("a.ts")).toBe("agent");
  });

  it("ignores directory entries and loading/error placeholders when scanning for local changes", () => {
    const overlay = buildChangeOverlay(changed({ baselineMs: 0 }), {
      "": [dirEntry("sub")],
      sub: "loading",
      other: "error",
    });

    expect(overlay.originByPath.size).toBe(0);
  });

  it("keeps an untouched file (mtime at or before baselineMs) unmarked", () => {
    const overlay = buildChangeOverlay(changed({ baselineMs: 100 }), { "": [fileEntry("same.ts", 100)] });

    expect(overlay.originByPath.has("same.ts")).toBe(false);
  });

  it("prefers agent over local on a folder both share, regardless of which is deeper", () => {
    const overlay = buildChangeOverlay(
      changed({ agentPaths: [{ relativePath: "src/a.ts", kind: "file", at: 10 }], baselineMs: 0 }),
      { "": [], src: [fileEntry("src/a.ts", 5)], "src/sub": [fileEntry("src/sub/b.ts", 999)] },
    );

    expect(overlay.changedDirs.get("src")).toBe("agent");
    expect(overlay.changedDirs.get("src/sub")).toBe("local");
  });

  it("leaves a changed file at the root out of the folder rollup", () => {
    const overlay = buildChangeOverlay(
      changed({ agentPaths: [{ relativePath: "readme.md", kind: "file", at: 1 }] }),
      {},
    );

    expect(overlay.changedDirs.size).toBe(0);
  });
});

describe("changeRowClass", () => {
  const overlay = buildChangeOverlay(
    changed({
      agentPaths: [{ relativePath: "src/agent.ts", kind: "file", at: 1 }],
      baselineMs: 100,
    }),
    { "": [fileEntry("src/local.ts", 500)], src: [fileEntry("src/agent.ts", 1), fileEntry("src/local.ts", 500)] },
  );

  it("names the exact origin of a changed file", () => {
    expect(changeRowClass(overlay, "src/agent.ts", "file")).toBe("change-agent");
    expect(changeRowClass(overlay, "src/local.ts", "file")).toBe("change-local");
  });

  it("marks a folder holding changes as 'below', not as changed itself", () => {
    expect(changeRowClass(overlay, "src", "directory")).toBe("change-below-agent");
  });

  it("says nothing about an untouched file or folder", () => {
    expect(changeRowClass(overlay, "docs", "directory")).toBeNull();
    expect(changeRowClass(overlay, "src/untouched.ts", "file")).toBeNull();
  });

  it("never reports a 'below' class for a plain file, only for directories", () => {
    // A file can never hold a folder rollup, even if by coincidence a directory of the same
    // relative path had one — changeRowClass only consults changedDirs for kind "directory".
    expect(changeRowClass(overlay, "src", "file")).toBeNull();
  });
});

describe("changeOriginLabel", () => {
  it("spells out each origin so the distinction never rides on color alone", () => {
    expect(changeOriginLabel("agent")).toBe("에이전트가 수정함");
    expect(changeOriginLabel("local")).toBe("세션 중 수정됨");
  });
});
