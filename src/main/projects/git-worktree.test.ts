// @vitest-environment node

import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeWorkspacePath, parseGitWorktreePorcelain } from "./git-worktree";

describe("parseGitWorktreePorcelain", () => {
  it("parses nul-delimited paths, detached, lock and prune metadata", () => {
    const output = [
      "worktree C:/작업 공간/repo",
      "HEAD 0123456789abcdef0123456789abcdef01234567",
      "branch refs/heads/main",
      "",
      "worktree C:/작업 공간/repo-wt/분리",
      "HEAD abcdef0123456789abcdef0123456789abcdef01",
      "detached",
      "locked 다른 프로세스가 사용 중",
      "prunable gitdir file points to non-existent location",
      "",
    ].join("\0");

    expect(parseGitWorktreePorcelain(output)).toEqual([
      {
        path: "C:/작업 공간/repo",
        head: "0123456789abcdef0123456789abcdef01234567",
        branch: "main",
        detached: false,
        lockedReason: null,
        prunableReason: null,
      },
      {
        path: "C:/작업 공간/repo-wt/분리",
        head: "abcdef0123456789abcdef0123456789abcdef01",
        branch: null,
        detached: true,
        lockedReason: "다른 프로세스가 사용 중",
        prunableReason: "gitdir file points to non-existent location",
      },
    ]);
  });

  it("normalizes paths case-insensitively only on Windows", () => {
    expect(normalizeWorkspacePath("C:/Repo/Feature", "win32")).toBe(
      path.win32.resolve("C:/Repo/Feature").toLocaleLowerCase("en-US"),
    );
    expect(normalizeWorkspacePath("/Repo/Feature", "linux")).toBe(path.posix.resolve("/Repo/Feature"));
  });
});
