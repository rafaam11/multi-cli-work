// @vitest-environment node
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedProject } from "../../shared/project-types";

const io = vi.hoisted(() => ({ active: 0, peak: 0, started: [] as string[], failStatusRoot: "" }));
vi.mock("node:child_process", () => {
  const execFile = (_file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    const root = args[1];
    const index = Number(root.match(/repo-(\d+)/)?.[1] ?? 0);
    io.active++;
    io.peak = Math.max(io.peak, io.active);
    io.started.push(args.slice(2).join(" "));
    setTimeout(() => {
      io.active--;
      if (args.includes("status") && root === io.failStatusRoot) {
        callback(new Error("unreadable status"), "", "");
        return;
      }
      let output = "";
      if (args.includes("--git-common-dir")) output = path.resolve(`repo-${index}`, ".git");
      else if (args.includes("--abbrev-ref")) output = "main\n";
      else if (args.includes("list")) output = `worktree ${root}\0HEAD abc\0branch refs/heads/main\0\0worktree ${root}-linked\0HEAD def\0branch refs/heads/feature\0\0`;
      else if (args.includes("status")) output = " M changed.txt\n";
      callback(null, output, "");
    }, 10 * (6 - index));
  };
  Object.assign(execFile, { [Symbol.for("nodejs.util.promisify.custom")]: (file: string, args: string[], options: unknown) =>
    new Promise((resolve, reject) => execFile(file, args, options, (error, stdout, stderr) =>
      error ? reject(error) : resolve({ stdout, stderr }))),
  });
  return { execFile };
});
vi.mock("./worktree-registry", () => ({
  readWorktreeRegistry: async () => ({ worktrees: {} }),
  applyWorktreeEntryChanges: vi.fn(async () => undefined),
}));
import { WorktreeService } from "./worktree-service";
import { readGitStatus } from "./git-status";

function project(index: number, id = `p${index}`, createdAt = `2026-01-0${index + 1}`): SharedProject {
  return { id, rootPath: path.resolve(`repo-${index}`), createdAt } as SharedProject;
}
function service() {
  let next = 0;
  return new WorktreeService({
    getProject: async () => null, stopWorktreeSessions: async () => undefined,
    removeWorktreeSessions: async () => undefined, idFactory: () => `w${++next}`, now: () => "now",
  });
}
beforeEach(() => { vi.useFakeTimers(); io.active = 0; io.peak = 0; io.started = []; io.failStatusRoot = ""; });
afterEach(() => { vi.useRealTimers(); });

describe("workspace Git command concurrency", () => {
  it("runs ordered workspace queries in parallel under one global four-command budget", async () => {
    const started = Date.now();
    const pending = service().sync([project(0), project(1), project(2), project(3), project(4), project(5)]);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(io.peak).toBe(4);
    expect(Date.now() - started).toBeLessThan(600);
    expect(result.warnings).toEqual({});
    expect(result.workspaces.map((item) => [item.projectId, item.worktreeId, item.changedFileCount])).toEqual([
      ["p0", null, 1], ["p0", "w1", 1], ["p1", null, 1], ["p1", "w2", 1],
      ["p2", null, 1], ["p2", "w3", 1], ["p3", null, 1], ["p3", "w4", 1],
      ["p4", null, 1], ["p4", "w5", 1], ["p5", null, 1], ["p5", "w6", 1],
    ]);
  });

  it("shares the cap across nested status queries, concurrent services and owner lookup", async () => {
    const projects = [project(0, "new", "2026-02-01"), project(1), project(0, "old", "2025-01-01")];
    const pending = Promise.all([
      service().ownerForPath(path.resolve("repo-0"), projects),
      service().sync([project(2), project(3), project(4)]),
      ...Array.from({ length: 6 }, (_, index) => readGitStatus(path.resolve(`repo-${index}`))),
    ]);
    await vi.runAllTimersAsync();
    const [owner, , ...statuses] = await pending;
    expect(io.peak).toBe(4);
    expect(owner).toEqual({ projectId: "old", worktreeId: null });
    expect(statuses).toEqual(Array.from({ length: 6 }, () => ({ isRepo: true, branch: "main", changedFileCount: 1 })));
  });

  it("releases failed command slots and preserves per-project warnings and partial ordered results", async () => {
    io.failStatusRoot = path.resolve("repo-0-linked");
    const pending = service().sync([project(0), project(1), project(0, "duplicate", "2027-01-01"), project(2)]);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.workspaces.map((item) => item.projectId)).toEqual(["p0", "p1", "p1", "p2", "p2"]);
    expect(result.warnings.p0).toBe("git status failed");
    expect(result.warnings.duplicate).toContain("프로젝트가 관리합니다");
    expect(io.active).toBe(0);
    expect(io.peak).toBe(4);
  });
});
