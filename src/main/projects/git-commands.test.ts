// @vitest-environment node

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkoutGitBranch,
  commitGitFiles,
  createGitBranch,
  fetchGitRemote,
  parseGitStatusV2,
  pullGitFastForward,
  pushCurrentBranch,
  readGitFileOriginal,
  readGitPanelData,
} from "./git-commands";

const execFileAsync = promisify(execFile);

let tempRoot: string;
let repoRoot: string;

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync(
    "git",
    ["-c", "user.email=test@example.com", "-c", "user.name=Test", ...args],
    { cwd, windowsHide: true },
  );
  return result.stdout;
}

async function write(relativePath: string, content: string): Promise<void> {
  await fs.writeFile(path.join(repoRoot, relativePath), content, "utf8");
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-git-commands-"));
  repoRoot = path.join(tempRoot, "repo");
  await fs.mkdir(repoRoot, { recursive: true });
  await git(repoRoot, "init", "-b", "main");
  // Production code commits without -c overrides, so the identity must live in the repo config.
  await git(repoRoot, "config", "user.email", "test@example.com");
  await git(repoRoot, "config", "user.name", "Test");
  await write("readme.md", "hello\n");
  await git(repoRoot, "add", ".");
  await git(repoRoot, "commit", "-m", "init");
});

afterEach(async () => {
  // Windows briefly holds handles after git exits; plain rm intermittently fails with EBUSY.
  await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("parseGitStatusV2", () => {
  it("reads branch headers, ordinary changes, untracked files, and renames", () => {
    const output = [
      "# branch.oid abc123",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -3",
      "1 .M N... 100644 100644 100644 abc def modified file.txt",
      "1 .D N... 100644 100644 000000 abc def gone.txt",
      "2 R. N... 100644 100644 100644 abc def R100 new name.txt",
      "old name.txt",
      "? fresh.txt",
    ].join("\0");

    expect(parseGitStatusV2(output)).toEqual({
      currentBranch: "main",
      upstream: "origin/main",
      ahead: 2,
      behind: 3,
      changes: [
        { path: "modified file.txt", status: "M" },
        { path: "gone.txt", status: "D" },
        { path: "new name.txt", status: "R", renamedFrom: "old name.txt" },
        { path: "fresh.txt", status: "?" },
      ],
    });
  });

  it("treats a detached HEAD as no current branch and missing upstream as null ahead/behind", () => {
    const parsed = parseGitStatusV2("# branch.head (detached)\0");
    expect(parsed.currentBranch).toBeNull();
    expect(parsed.upstream).toBeNull();
    expect(parsed.ahead).toBeNull();
    expect(parsed.behind).toBeNull();
  });
});

describe("git panel data against a real repo", () => {
  it("reports branch, changes, and the branch list", async () => {
    await write("readme.md", "changed\n");
    await write("fresh.txt", "new\n");

    const data = await readGitPanelData(repoRoot);

    expect(data.isRepo).toBe(true);
    expect(data.currentBranch).toBe("main");
    expect(data.branches).toContain("main");
    expect(data.changes).toEqual(
      expect.arrayContaining([
        { path: "readme.md", status: "M" },
        { path: "fresh.txt", status: "?" },
      ]),
    );
  });

  it("collapses a folder that is not a repository to isRepo: false", async () => {
    const plainDir = path.join(tempRoot, "plain");
    await fs.mkdir(plainDir, { recursive: true });

    const data = await readGitPanelData(plainDir);

    expect(data).toEqual({
      isRepo: false,
      currentBranch: null,
      upstream: null,
      ahead: null,
      behind: null,
      branches: [],
      changes: [],
    });
  });
});

describe("branch operations", () => {
  it("creates a branch, then checks the original back out", async () => {
    await createGitBranch(repoRoot, "feature/x");
    expect((await readGitPanelData(repoRoot)).currentBranch).toBe("feature/x");

    await checkoutGitBranch(repoRoot, "main");
    expect((await readGitPanelData(repoRoot)).currentBranch).toBe("main");
  });

  it("rejects branch names git would parse as options", async () => {
    await expect(createGitBranch(repoRoot, "-oops")).rejects.toThrow("Branch name is invalid");
  });
});

describe("commitGitFiles", () => {
  it("commits exactly the checked files, staging untracked ones first", async () => {
    await write("readme.md", "changed\n");
    await write("fresh.txt", "new\n");
    await write("unchecked.txt", "left behind\n");

    await commitGitFiles(repoRoot, {
      summary: "commit checked files",
      description: "body line",
      paths: ["readme.md", "fresh.txt"],
    });

    const remaining = (await readGitPanelData(repoRoot)).changes;
    expect(remaining).toEqual([{ path: "unchecked.txt", status: "?" }]);
    const message = await git(repoRoot, "log", "-1", "--format=%B");
    expect(message).toContain("commit checked files");
    expect(message).toContain("body line");
  });

  it("leaves what the user staged by hand for unchecked files untouched", async () => {
    await write("readme.md", "changed\n");
    await write("staged.txt", "staged by hand\n");
    await git(repoRoot, "add", "staged.txt");

    await commitGitFiles(repoRoot, { summary: "only readme", description: "", paths: ["readme.md"] });

    const status = await git(repoRoot, "status", "--porcelain");
    expect(status).toContain("A  staged.txt");
    expect(status).not.toContain("readme.md");
  });

  it("rejects paths that no longer have changes instead of committing something else", async () => {
    await expect(
      commitGitFiles(repoRoot, { summary: "stale", description: "", paths: ["readme.md"] }),
    ).rejects.toThrow("No changes left to commit");
  });
});

describe("readGitFileOriginal", () => {
  it("returns the HEAD content for a tracked file and empty for a path new since HEAD", async () => {
    await write("readme.md", "changed\n");
    await write("fresh.txt", "new\n");

    expect(await readGitFileOriginal(repoRoot, "readme.md")).toEqual({ content: "hello\n", truncated: false });
    expect(await readGitFileOriginal(repoRoot, "fresh.txt")).toEqual({ content: "", truncated: false });
  });

  it("refuses paths that escape the repository, collapsing them to empty", async () => {
    expect(await readGitFileOriginal(repoRoot, "../outside.txt")).toEqual({ content: "", truncated: false });
  });
});

describe("remote operations against a local bare origin", () => {
  let originPath: string;

  beforeEach(async () => {
    originPath = path.join(tempRoot, "origin.git");
    await git(tempRoot, "init", "--bare", originPath);
    // A fresh bare repo's HEAD points at the default branch name, not "main"; clones of it would
    // otherwise come up with no checked-out branch and no upstream.
    await git(originPath, "symbolic-ref", "HEAD", "refs/heads/main");
    await git(repoRoot, "remote", "add", "origin", originPath);
  });

  it("publishes a branch without upstream via push -u, making ahead/behind available", async () => {
    await pushCurrentBranch(repoRoot);

    const data = await readGitPanelData(repoRoot);
    expect(data.upstream).toBe("origin/main");
    expect(data.ahead).toBe(0);
    expect(data.behind).toBe(0);
  });

  it("pushes, fetches, and fast-forward pulls through a clone", async () => {
    await pushCurrentBranch(repoRoot);

    const clonePath = path.join(tempRoot, "clone");
    await git(tempRoot, "clone", originPath, clonePath);
    await git(clonePath, "config", "user.email", "test@example.com");
    await git(clonePath, "config", "user.name", "Test");

    await write("readme.md", "ahead\n");
    await commitGitFiles(repoRoot, { summary: "go ahead", description: "", paths: ["readme.md"] });
    await pushCurrentBranch(repoRoot);

    await fetchGitRemote(clonePath);
    const behindData = await readGitPanelData(clonePath);
    expect(behindData.behind).toBe(1);

    await pullGitFastForward(clonePath);
    const caughtUp = await readGitPanelData(clonePath);
    expect(caughtUp.behind).toBe(0);
  });
});
