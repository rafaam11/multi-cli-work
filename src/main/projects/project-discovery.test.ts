// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codexProjectRefFromCwd, discoverClaudeProjects, discoverCodexProjects } from "./project-discovery";

const streamFailures = vi.hoisted(() => ({ unreadablePath: undefined as string | undefined }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    createReadStream: (...args: Parameters<typeof actual.createReadStream>) => {
      if (String(args[0]) === streamFailures.unreadablePath) {
        throw Object.assign(new Error("access denied"), { code: "EACCES" });
      }
      return actual.createReadStream(...args);
    },
  };
});

const tempRoots: string[] = [];

async function tempDirectory(name: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), `mcw-${name}-`));
  tempRoots.push(root);
  return root;
}

async function writeTranscript(filePath: string, lines: unknown[], modifiedAt: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `${lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n")}\n`,
    "utf8",
  );
  const timestamp = new Date(modifiedAt);
  await fs.utimes(filePath, timestamp, timestamp);
}

afterEach(async () => {
  streamFailures.unreadablePath = undefined;
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("Claude project discovery", () => {
  it("reads cwd and project aliases from recent nested transcripts", async () => {
    const projectsDirectory = await tempDirectory("claude-discovery");
    await writeTranscript(
      path.join(projectsDirectory, "old-project", "old.jsonl"),
      [{ cwd: "C:\\Old", sessionId: "claude-old" }],
      "2026-07-01T00:00:00.000Z",
    );
    await writeTranscript(
      path.join(projectsDirectory, "new-project", "new.jsonl"),
      ["{malformed", { type: "mode", sessionId: "claude-new" }, { cwd: "C:\\New", sessionId: "claude-new" }],
      "2026-07-11T02:00:00.000Z",
    );
    await writeTranscript(
      path.join(projectsDirectory, "ignored-project", "missing-cwd.jsonl"),
      [{ type: "mode", cwd: "relative-project", sessionId: "claude-ignored" }],
      "2026-07-11T01:00:00.000Z",
    );

    const discoveries = await discoverClaudeProjects({ projectsDirectory, maxFiles: 2 });

    expect(discoveries).toEqual([
      { rootPath: "C:\\New", source: "claude", providerRef: "new-project" },
    ]);
  });

  it("returns no discoveries when the transcript directory is missing", async () => {
    const root = await tempDirectory("claude-missing");

    await expect(
      discoverClaudeProjects({ projectsDirectory: path.join(root, "does-not-exist") }),
    ).resolves.toEqual([]);
  });

  it("skips an unreadable transcript without dropping readable discoveries", async () => {
    const projectsDirectory = await tempDirectory("claude-unreadable");
    const unreadablePath = path.join(projectsDirectory, "blocked-project", "blocked.jsonl");
    await writeTranscript(unreadablePath, [{ cwd: "C:\\Blocked" }], "2026-07-11T02:00:00.000Z");
    await writeTranscript(
      path.join(projectsDirectory, "readable-project", "readable.jsonl"),
      [{ cwd: "C:\\Readable" }],
      "2026-07-11T01:00:00.000Z",
    );
    streamFailures.unreadablePath = unreadablePath;

    await expect(discoverClaudeProjects({ projectsDirectory })).resolves.toEqual([
      { rootPath: "C:\\Readable", source: "claude", providerRef: "readable-project" },
    ]);
  });
});

describe("Codex project discovery", () => {
  it("accepts only session_meta records with a cwd and derives project aliases without session ids", async () => {
    const sessionsDirectory = await tempDirectory("codex-discovery");
    await writeTranscript(
      path.join(sessionsDirectory, "2026", "07", "11", "valid.jsonl"),
      [
        "not-json",
        { type: "event_msg", payload: { cwd: "C:\\Wrong", id: "wrong" } },
        { type: "session_meta", payload: { cwd: "C:\\Codex", id: "codex-session" } },
      ],
      "2026-07-11T02:00:00.000Z",
    );
    await writeTranscript(
      path.join(sessionsDirectory, "2026", "07", "10", "meta-without-session-id.jsonl"),
      [{ type: "session_meta", payload: { cwd: "C:\\NoId" } }],
      "2026-07-10T02:00:00.000Z",
    );

    const discoveries = await discoverCodexProjects({ sessionsDirectory });

    expect(discoveries).toEqual([
      { rootPath: "C:\\Codex", source: "codex", providerRef: "codex:C--Codex" },
      { rootPath: "C:\\NoId", source: "codex", providerRef: "codex:C--NoId" },
    ]);
  });

  it("derives Harness-compatible project aliases from Windows and POSIX cwd values", () => {
    expect(codexProjectRefFromCwd("c:\\work\\nested\\")).toBe("codex:C--work-nested");
    expect(codexProjectRefFromCwd("/srv/work/nested/")).toBe("codex:-srv-work-nested");
  });

  it("returns no discoveries when transcript files are malformed", async () => {
    const sessionsDirectory = await tempDirectory("codex-malformed");
    await writeTranscript(
      path.join(sessionsDirectory, "broken.jsonl"),
      ["{broken", "[]", { type: "session_meta", payload: { cwd: "relative-project" } }],
      "2026-07-11T00:00:00.000Z",
    );

    await expect(discoverCodexProjects({ sessionsDirectory, platform: "win32" })).resolves.toEqual([]);
  });

  it("ignores POSIX roots that belong to excluded WSL sessions on Windows", async () => {
    const sessionsDirectory = await tempDirectory("codex-wsl");
    await writeTranscript(
      path.join(sessionsDirectory, "wsl.jsonl"),
      [{ type: "session_meta", payload: { cwd: "/home/user/project", id: "wsl-session" } }],
      "2026-07-11T00:00:00.000Z",
    );

    await expect(discoverCodexProjects({ sessionsDirectory, platform: "win32" })).resolves.toEqual([]);
  });
});
