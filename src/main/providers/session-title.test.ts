// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claudeProjectSlug,
  condenseTitle,
  parseClaudeTitle,
  parseCodexTitle,
  readSessionTitle,
  SessionTitleReader,
} from "./session-title";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-title-"));
  roots.push(root);
  return root;
}

function jsonl(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("claudeProjectSlug", () => {
  it("replaces every non-alphanumeric character, matching Claude's own directory naming", () => {
    expect(claudeProjectSlug("C:\\Users\\me\\Desktop\\3_Hobby_ws\\multi-cli-work")).toBe(
      "C--Users-me-Desktop-3-Hobby-ws-multi-cli-work",
    );
    expect(claudeProjectSlug("/home/me/work")).toBe("-home-me-work");
  });
});

describe("condenseTitle", () => {
  it("collapses whitespace and truncates long titles", () => {
    expect(condenseTitle("  a\n  multi   line\ttitle  ")).toBe("a multi line title");
    expect(condenseTitle("x".repeat(80))).toBe(`${"x".repeat(59)}…`);
    expect(condenseTitle("   ")).toBeNull();
  });
});

describe("parseClaudeTitle", () => {
  it("takes the last ai-title because Claude rewrites it as the work moves on", () => {
    const transcript = jsonl([
      { type: "user", message: "hi" },
      { type: "ai-title", aiTitle: "첫 제목", sessionId: "s1" },
      { type: "assistant", message: "ok" },
      { type: "ai-title", aiTitle: "최종 제목", sessionId: "s1" },
    ]);

    expect(parseClaudeTitle(transcript)).toBe("최종 제목");
  });

  it("ignores a half-written trailing line instead of losing the title", () => {
    const transcript = `${jsonl([{ type: "ai-title", aiTitle: "제목", sessionId: "s1" }])}{"type":"ai-tit`;

    expect(parseClaudeTitle(transcript)).toBe("제목");
  });

  it("returns null when no title has been generated yet", () => {
    expect(parseClaudeTitle(jsonl([{ type: "user", message: "hi" }]))).toBeNull();
    expect(parseClaudeTitle("")).toBeNull();
  });
});

describe("parseCodexTitle", () => {
  it("stands in the first user message for the title Codex does not write", () => {
    const transcript = jsonl([
      { type: "session_meta", payload: { id: "c1", cwd: "C:\\Work" } },
      { type: "event_msg", payload: { type: "task_started" } },
      { type: "event_msg", payload: { type: "user_message", message: "deck을 휴대폰에서 쓰고 싶어" } },
      { type: "event_msg", payload: { type: "user_message", message: "두 번째 질문" } },
    ]);

    expect(parseCodexTitle(transcript)).toBe("deck을 휴대폰에서 쓰고 싶어");
  });

  it("returns null before the user has said anything", () => {
    expect(parseCodexTitle(jsonl([{ type: "session_meta", payload: { id: "c1" } }]))).toBeNull();
  });
});

describe("readSessionTitle", () => {
  it("reads a Claude title from the transcript the slug points at", async () => {
    const root = await tempRoot();
    const cwd = "C:\\Work\\Example";
    const directory = path.join(root, claudeProjectSlug(cwd));
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, "conversation-1.jsonl"),
      jsonl([{ type: "ai-title", aiTitle: "레지스트리 분리" }]),
      "utf8",
    );

    await expect(
      readSessionTitle(
        { titleSource: "claude-transcript", cwd, providerConversationId: "conversation-1" },
        { claudeProjectsDirectory: root },
      ),
    ).resolves.toBe("레지스트리 분리");
  });

  it("falls back to scanning when Claude's directory naming does not match the slug", async () => {
    const root = await tempRoot();
    const directory = path.join(root, "some-other-naming-scheme");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, "conversation-1.jsonl"),
      jsonl([{ type: "ai-title", aiTitle: "찾았다" }]),
      "utf8",
    );

    await expect(
      readSessionTitle(
        { titleSource: "claude-transcript", cwd: "C:\\Work\\Example", providerConversationId: "conversation-1" },
        { claudeProjectsDirectory: root },
      ),
    ).resolves.toBe("찾았다");
  });

  it("reads Codex only from the exact transcript path supplied by its hook", async () => {
    const root = await tempRoot();
    const directory = path.join(root, "2026", "07", "12");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, "rollout-2026-07-12T17-34-35-conversation-2.jsonl"),
      jsonl([{ type: "event_msg", payload: { type: "user_message", message: "첫 프롬프트" } }]),
      "utf8",
    );

    await expect(
      readSessionTitle(
        { titleSource: "codex-transcript", cwd: "C:\\Work", providerConversationId: "conversation-2", transcriptPath: path.join(directory, "rollout-2026-07-12T17-34-35-conversation-2.jsonl") },
        { codexSessionsDirectory: root },
      ),
    ).resolves.toBe("첫 프롬프트");
  });

  it("has no title for a shell, an uncorrelated session, or a missing transcript", async () => {
    const root = await tempRoot();

    await expect(
      readSessionTitle({ titleSource: "none", cwd: "C:\\Work", providerConversationId: null }, {}),
    ).resolves.toBeNull();
    await expect(
      readSessionTitle({ titleSource: "codex-transcript", cwd: "C:\\Work", providerConversationId: null }, { codexSessionsDirectory: root }),
    ).resolves.toBeNull();
    await expect(
      readSessionTitle(
        { titleSource: "claude-transcript", cwd: "C:\\Work", providerConversationId: "missing" },
        { claudeProjectsDirectory: root },
      ),
    ).resolves.toBeNull();
  });
});

describe("SessionTitleReader caching", () => {
  it("caches transcript discovery and reads only the appended Claude bytes", async () => {
    const root = await tempRoot();
    const cwd = "C:\\Work\\Cached";
    const directory = path.join(root, claudeProjectSlug(cwd));
    const transcript = path.join(directory, "conversation-cache.jsonl");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(transcript, jsonl([{ type: "ai-title", aiTitle: "첫 제목" }]));
    const reads: Array<{ start: number; length: number }> = [];
    let directoryReads = 0;
    const reader = new SessionTitleReader({
      stat: (filePath) => fs.stat(filePath),
      readdir: async (filePath) => { directoryReads += 1; return fs.readdir(filePath, { withFileTypes: true }); },
      read: async (filePath, start, length) => {
        reads.push({ start, length });
        const handle = await fs.open(filePath, "r");
        try {
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, start);
          return buffer.subarray(0, bytesRead);
        } finally { await handle.close(); }
      },
    });
    const source = { titleSource: "claude-transcript" as const, cwd, providerConversationId: "conversation-cache" };

    await expect(reader.read(source, { claudeProjectsDirectory: root })).resolves.toBe("첫 제목");
    const firstSize = (await fs.stat(transcript)).size;
    await fs.appendFile(transcript, jsonl([{ type: "ai-title", aiTitle: "바뀐 제목" }]));
    await expect(reader.read(source, { claudeProjectsDirectory: root })).resolves.toBe("바뀐 제목");

    expect(directoryReads).toBe(0);
    expect(reads).toEqual([
      { start: 0, length: firstSize },
      { start: firstSize, length: (await fs.stat(transcript)).size - firstSize },
    ]);
  });

  it("uses an exact Codex hook path and performs no more I/O after finding the first title", async () => {
    const root = await tempRoot();
    const transcript = path.join(root, "exact.jsonl");
    await fs.writeFile(transcript, jsonl([{ type: "event_msg", payload: { type: "user_message", message: "정확한 제목" } }]));
    let stats = 0;
    let reads = 0;
    const reader = new SessionTitleReader({
      stat: async (filePath) => { stats += 1; return fs.stat(filePath); },
      readdir: async () => { throw new Error("Codex transcript must not be guessed"); },
      read: async (filePath, start, length) => {
        reads += 1;
        const content = await fs.readFile(filePath);
        return content.subarray(start, start + length);
      },
    });
    const source = { titleSource: "codex-transcript" as const, cwd: root, providerConversationId: "id", transcriptPath: transcript };

    await expect(reader.read(source)).resolves.toBe("정확한 제목");
    await expect(reader.read(source)).resolves.toBe("정확한 제목");

    expect(stats).toBe(1);
    expect(reads).toBe(1);
  });
});
