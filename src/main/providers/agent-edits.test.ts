// @vitest-environment node

import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeProjectSlug } from "./session-title";
import { AgentEditReader, parseClaudeEditedPaths, parseCodexEditedPaths } from "./agent-edits";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.env.TEMP ?? process.cwd(), "mcw-edits-"));
  roots.push(root);
  return root;
}

function jsonl(records: unknown[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("parseClaudeEditedPaths", () => {
  it("collects file_path from every edit-tool call, in the real (variable-key-order) shape", () => {
    const transcript = jsonl([
      { type: "user", message: { role: "user", content: "고쳐줘" } },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "고칠게요" },
            // Edit's real payload puts replace_all before file_path — a regex on `"file_path"` position
            // would be fragile, which is why this parser JSON.parses instead.
            { type: "tool_use", name: "Edit", input: { replace_all: false, file_path: "C:\\repo\\a.ts", old_string: "x", new_string: "y" } },
          ],
        },
      },
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", name: "Write", input: { file_path: "C:\\repo\\b.ts", content: "..." } },
            { type: "tool_use", name: "NotebookEdit", input: { file_path: "C:\\repo\\c.ipynb" } },
            { type: "tool_use", name: "MultiEdit", input: { file_path: "C:\\repo\\d.ts", edits: [] } },
            // Not an edit tool — must be ignored.
            { type: "tool_use", name: "Read", input: { file_path: "C:\\repo\\e.ts" } },
          ],
        },
      },
    ]);

    expect(parseClaudeEditedPaths(transcript)).toEqual([
      "C:\\repo\\a.ts",
      "C:\\repo\\b.ts",
      "C:\\repo\\c.ipynb",
      "C:\\repo\\d.ts",
    ]);
  });

  it("ignores a half-written trailing line instead of throwing", () => {
    const complete = jsonl([
      { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "C:\\repo\\a.ts" } }] } },
    ]);
    const transcript = `${complete}{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","inp`;

    expect(parseClaudeEditedPaths(transcript)).toEqual(["C:\\repo\\a.ts"]);
  });

  it("returns nothing for a transcript with no edit tool calls", () => {
    expect(parseClaudeEditedPaths(jsonl([{ type: "user", message: { role: "user", content: "hi" } }]))).toEqual([]);
    expect(parseClaudeEditedPaths("")).toEqual([]);
  });
});

describe("parseCodexEditedPaths", () => {
  it("reads only the keys of `changes`, never the embedded file content", () => {
    const transcript = jsonl([
      { type: "session_meta", payload: { id: "c1" } },
      {
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: {
            type: "FileChange",
            changes: {
              "C:\\repo\\a.ts": { type: "update", content: "전체 파일 내용..." },
              "C:\\repo\\b.ts": { type: "add", content: "..." },
            },
          },
        },
      },
      // Not a FileChange item — must be ignored.
      { type: "event_msg", payload: { type: "item_completed", item: { type: "AgentMessage", text: "done" } } },
    ]);

    expect(parseCodexEditedPaths(transcript)).toEqual(["C:\\repo\\a.ts", "C:\\repo\\b.ts"]);
  });

  it("skips a line longer than the size guard instead of JSON.parsing a multi-MB payload", () => {
    const hugeContent = "x".repeat(17 * 1024 * 1024);
    const hugeLine = JSON.stringify({
      type: "event_msg",
      payload: { type: "item_completed", item: { type: "FileChange", changes: { "C:\\repo\\huge.ts": { type: "update", content: hugeContent } } } },
    });
    const normalLine = JSON.stringify({
      type: "event_msg",
      payload: { type: "item_completed", item: { type: "FileChange", changes: { "C:\\repo\\normal.ts": { type: "update", content: "x" } } } },
    });

    expect(parseCodexEditedPaths(`${hugeLine}\n${normalLine}\n`)).toEqual(["C:\\repo\\normal.ts"]);
  });

  it("ignores a half-written trailing line instead of throwing", () => {
    const complete = jsonl([
      { type: "event_msg", payload: { type: "item_completed", item: { type: "FileChange", changes: { "C:\\repo\\a.ts": { type: "add", content: "x" } } } } },
    ]);
    const transcript = `${complete}{"type":"event_msg","payload":{"type":"item_completed","item":{"type":"FileCha`;

    expect(parseCodexEditedPaths(transcript)).toEqual(["C:\\repo\\a.ts"]);
  });
});

describe("AgentEditReader", () => {
  it("reads only appended bytes across repeated refreshes, like SessionTitleReader", async () => {
    const root = await tempRoot();
    const cwd = "C:\\Work\\Example";
    const directory = path.join(root, claudeProjectSlug(cwd));
    const transcript = path.join(directory, "conversation-1.jsonl");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      transcript,
      jsonl([{ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "C:\\repo\\a.ts" } }] } }]),
      "utf8",
    );
    const reads: Array<{ start: number; length: number }> = [];
    const reader = new AgentEditReader({
      stat: (filePath) => fs.stat(filePath),
      readdir: (filePath) => fs.readdir(filePath, { withFileTypes: true }),
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
    const source = { titleSource: "claude-transcript" as const, cwd, providerConversationId: "conversation-1" };

    await expect(reader.refresh(source, { claudeProjectsDirectory: root })).resolves.toBe(true);
    expect([...reader.entries().keys()]).toEqual([path.normalize("C:\\repo\\a.ts")]);

    // Nothing new appended: a second refresh must report no change, not re-announce the same edit.
    await expect(reader.refresh(source, { claudeProjectsDirectory: root })).resolves.toBe(false);

    const firstSize = (await fs.stat(transcript)).size;
    await fs.appendFile(
      transcript,
      jsonl([{ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Write", input: { file_path: "C:\\repo\\b.ts" } }] } }]),
    );
    await expect(reader.refresh(source, { claudeProjectsDirectory: root })).resolves.toBe(true);
    expect([...reader.entries().keys()].sort()).toEqual([path.normalize("C:\\repo\\a.ts"), path.normalize("C:\\repo\\b.ts")].sort());

    expect(reads).toEqual([
      { start: 0, length: firstSize },
      { start: firstSize, length: (await fs.stat(transcript)).size - firstSize },
    ]);
  });

  it("only reads Codex from the exact hook-supplied transcript path", async () => {
    const root = await tempRoot();
    const transcript = path.join(root, "exact.jsonl");
    await fs.writeFile(
      transcript,
      jsonl([{ type: "event_msg", payload: { type: "item_completed", item: { type: "FileChange", changes: { "C:\\repo\\a.ts": { type: "add", content: "x" } } } } }]),
    );
    const reader = new AgentEditReader({
      stat: (filePath) => fs.stat(filePath),
      readdir: async () => { throw new Error("Codex transcript must not be guessed"); },
      read: async (filePath, start, length) => {
        const content = await fs.readFile(filePath);
        return content.subarray(start, start + length);
      },
    });
    const source = { titleSource: "codex-transcript" as const, cwd: root, providerConversationId: "id", transcriptPath: transcript };

    await expect(reader.refresh(source)).resolves.toBe(true);
    expect([...reader.entries().keys()]).toEqual([path.normalize("C:\\repo\\a.ts")]);

    // No hook path and no cached one yet for a fresh session — must not guess by scanning the directory.
    const fresh = new AgentEditReader();
    await expect(
      fresh.refresh({ titleSource: "codex-transcript", cwd: root, providerConversationId: "other" }, { codexSessionsDirectory: root }),
    ).resolves.toBe(false);
  });

  it("clear() empties the index for the 지우기 button", async () => {
    const root = await tempRoot();
    const transcript = path.join(root, "exact.jsonl");
    await fs.writeFile(
      transcript,
      jsonl([{ type: "event_msg", payload: { type: "item_completed", item: { type: "FileChange", changes: { "C:\\repo\\a.ts": { type: "add", content: "x" } } } } }]),
    );
    const reader = new AgentEditReader();
    const source = { titleSource: "codex-transcript" as const, cwd: root, providerConversationId: "id", transcriptPath: transcript };

    await reader.refresh(source);
    expect(reader.entries().size).toBe(1);
    reader.clear();
    expect(reader.entries().size).toBe(0);
  });

  it("clear(predicate) only removes entries the predicate matches, for root-scoped 지우기", async () => {
    const root = await tempRoot();
    const transcript = path.join(root, "exact.jsonl");
    await fs.writeFile(
      transcript,
      jsonl([{
        type: "event_msg",
        payload: {
          type: "item_completed",
          item: {
            type: "FileChange",
            changes: {
              "C:\\repo-a\\a.ts": { type: "add", content: "x" },
              "C:\\repo-b\\b.ts": { type: "add", content: "x" },
            },
          },
        },
      }]),
    );
    const reader = new AgentEditReader();
    const source = { titleSource: "codex-transcript" as const, cwd: root, providerConversationId: "id", transcriptPath: transcript };

    await reader.refresh(source);
    expect(reader.entries().size).toBe(2);

    // Only "지우기" the repo-a root's entries — repo-b, an unrelated open project, must be untouched.
    reader.clear((absolutePath) => absolutePath.startsWith(path.normalize("C:\\repo-a")));
    expect([...reader.entries().keys()]).toEqual([path.normalize("C:\\repo-b\\b.ts")]);
  });

  it("has nothing to report for a shell session or one with no conversation id", async () => {
    const reader = new AgentEditReader();
    await expect(reader.refresh({ titleSource: "none", cwd: "C:\\Work", providerConversationId: null })).resolves.toBe(false);
    await expect(
      reader.refresh({ titleSource: "claude-transcript", cwd: "C:\\Work", providerConversationId: null }),
    ).resolves.toBe(false);
  });
});
