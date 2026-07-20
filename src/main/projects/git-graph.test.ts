import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertFullCommitHash,
  cherryPickGitCommit,
  createGitGraphBranch,
  createGitGraphTag,
  listGitGraph,
  parseGitLog,
  parseGitRefs,
  parseNameStatus,
  readGitCommitDetails,
  readGitCommitFileDiff,
  revertGitCommit,
} from "./git-graph";

const exec = promisify(execFile);
const roots: string[] = [];

async function repo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcw-git-graph-"));
  roots.push(root);
  await exec("git", ["init", "-b", "main"], { cwd: root });
  await exec("git", ["config", "user.name", "테스터"], { cwd: root });
  await exec("git", ["config", "user.email", "test@example.com"], { cwd: root });
  return root;
}

async function commit(root: string, name: string, content: string, message: string) {
  await fs.writeFile(path.join(root, name), content);
  await exec("git", ["add", "."], { cwd: root });
  await exec("git", ["commit", "-m", message], { cwd: root });
  return (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
}

afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe("git graph parsers", () => {
  it("parses root, merge metadata, refs, unicode, and rename records", () => {
    expect(parseGitLog(`abc\x1fleft right\x1f홍길동\x1f2026-01-01T00:00:00Z\x1f한글 제목\x1e`)[0]).toMatchObject({ parents: ["left", "right"], subject: "한글 제목" });
    expect(parseGitRefs(`abc\x1f\x1frefs/heads/main\nabc\x1fpeeled\x1frefs/tags/v1\n`).get("abc")?.[0].kind).toBe("local");
    expect(parseGitRefs(`abc\x1fpeeled\x1frefs/tags/v1\n`).get("peeled")?.[0].kind).toBe("tag");
    expect(parseNameStatus("R100\0old name.ts\0new name.ts\0A\0added.ts\0")).toEqual([
      { status: "R", oldPath: "old name.ts", path: "new name.ts" },
      { status: "A", path: "added.ts" },
    ]);
  });

  it("rejects abbreviated and malformed hashes", () => {
    expect(() => assertFullCommitHash("abc123")).toThrow(/full SHA/);
    expect(() => assertFullCommitHash("g".repeat(40))).toThrow(/full SHA/);
  });
});

describe("native git graph", () => {
  it("handles an empty repository and paginates commits", async () => {
    const root = await repo();
    await expect(listGitGraph(root, { offset: 0, limit: 200 })).resolves.toMatchObject({ commits: [], hasMore: false });
    await commit(root, "a.txt", "a", "첫 커밋");
    const latest = await commit(root, "b.txt", "b", "second");
    await exec("git", ["tag", "v2", latest], { cwd: root });
    await exec("git", ["update-ref", "refs/remotes/origin/main", latest], { cwd: root });
    await exec("git", ["checkout", "--detach", latest], { cwd: root });
    const first = await listGitGraph(root, { offset: 0, limit: 1 });
    expect(first.commits).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(first.commits[0].refs.map((ref) => ref.kind)).toEqual(expect.arrayContaining(["head", "local", "remote", "tag"]));
    expect((await listGitGraph(root, { offset: 1, limit: 1 })).commits[0].subject).toBe("첫 커밋");
  });

  it("reads root details and text/binary diffs", async () => {
    const root = await repo();
    const hash = await commit(root, "hello.txt", "hello\n", "root");
    const details = await readGitCommitDetails(root, hash);
    expect(details.parents).toEqual([]);
    expect(details.files).toEqual([{ status: "A", path: "hello.txt" }]);
    await expect(readGitCommitFileDiff(root, hash, "hello.txt")).resolves.toMatchObject({ original: "", modified: "hello\n", binary: false });
    await expect(readGitCommitFileDiff(root, hash, "missing.txt")).rejects.toThrow(/not changed/);
  });

  it("identifies renames and binary files", async () => {
    const root = await repo();
    await commit(root, "old.txt", "same enough content\n".repeat(20), "root");
    await exec("git", ["mv", "old.txt", "new.txt"], { cwd: root });
    await fs.writeFile(path.join(root, "image.bin"), Buffer.from([0, 1, 2, 3]));
    await exec("git", ["add", "."], { cwd: root });
    await exec("git", ["commit", "-m", "rename and binary"], { cwd: root });
    const hash = (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    expect((await readGitCommitDetails(root, hash)).files).toEqual(expect.arrayContaining([{ status: "R", oldPath: "old.txt", path: "new.txt" }, { status: "A", path: "image.bin" }]));
    await expect(readGitCommitFileDiff(root, hash, "image.bin")).resolves.toMatchObject({ binary: true, original: "", modified: "" });
  });

  it("compares a merge commit with its first parent", async () => {
    const root = await repo();
    await commit(root, "base.txt", "base", "root");
    await exec("git", ["checkout", "-b", "side"], { cwd: root });
    await commit(root, "side.txt", "side", "side");
    await exec("git", ["checkout", "main"], { cwd: root });
    await commit(root, "main.txt", "main", "main");
    await exec("git", ["merge", "--no-ff", "side", "-m", "merge"], { cwd: root });
    const hash = (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    const details = await readGitCommitDetails(root, hash);
    expect(details.parents).toHaveLength(2);
    expect(details.files).toEqual([{ status: "A", path: "side.txt" }]);
  });

  it("creates validated branches and lightweight tags", async () => {
    const root = await repo();
    const hash = await commit(root, "a.txt", "a", "root");
    await createGitGraphBranch(root, hash, "feature/native", false);
    await createGitGraphTag(root, hash, "v1.0.0");
    expect((await exec("git", ["show-ref", "--verify", "refs/heads/feature/native"], { cwd: root })).stdout).toContain(hash);
    expect((await exec("git", ["cat-file", "-t", "refs/tags/v1.0.0"], { cwd: root })).stdout.trim()).toBe("commit");
    await expect(createGitGraphBranch(root, hash, "bad..name", false)).rejects.toThrow(/valid branch|check-ref-format/);
  });

  it("cherry-picks and reverts ordinary commits", async () => {
    const root = await repo();
    await commit(root, "base.txt", "base", "root");
    await exec("git", ["checkout", "-b", "source"], { cwd: root });
    const picked = await commit(root, "picked.txt", "picked", "pick me");
    await exec("git", ["checkout", "main"], { cwd: root });
    await cherryPickGitCommit(root, picked);
    await expect(fs.readFile(path.join(root, "picked.txt"), "utf8")).resolves.toBe("picked");
    const applied = (await exec("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    await revertGitCommit(root, applied);
    await expect(fs.stat(path.join(root, "picked.txt"))).rejects.toThrow();
  });

  it("passes conflict stderr through with terminal recovery guidance", async () => {
    const root = await repo();
    await commit(root, "same.txt", "base\n", "root");
    await exec("git", ["checkout", "-b", "source"], { cwd: root });
    const source = await commit(root, "same.txt", "source\n", "source change");
    await exec("git", ["checkout", "main"], { cwd: root });
    await commit(root, "same.txt", "main\n", "main change");
    await expect(cherryPickGitCommit(root, source)).rejects.toThrow(/could not apply[\s\S]*cherry-pick --continue[\s\S]*cherry-pick --abort/);
  });
});
