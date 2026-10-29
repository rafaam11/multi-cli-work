// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BoardMessage } from "../../shared/board-types";
import { BoardStore } from "./board-store";

function message(id: string, overrides: Partial<BoardMessage> = {}): BoardMessage {
  return {
    id,
    projectId: "project-1",
    author: { kind: "user" },
    kind: "post",
    text: `text ${id}`,
    to: [],
    createdAt: "2026-10-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("BoardStore", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "board-store-"));
  });

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("appends messages and patches, and a fresh store reads them back", async () => {
    const store = new BoardStore(directory);
    await store.append(message("a"));
    await store.append(message("b"));
    const patched = await store.patch("project-1", "a", [{ sessionId: "s", name: "s", agent: "codex", delivery: "delivered" }]);
    expect(patched?.to[0].delivery).toBe("delivered");
    expect(await store.patch("project-1", "missing", [])).toBeNull();

    const reopened = new BoardStore(directory);
    const messages = await reopened.list("project-1");
    expect(messages.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(messages[0].to[0].delivery).toBe("delivered");
    expect(await reopened.list("project-2")).toEqual([]);
  });

  it("skips a torn last line", async () => {
    const store = new BoardStore(directory);
    await store.append(message("a"));
    await fs.appendFile(path.join(directory, "project-1.jsonl"), '{"type":"message","mess', "utf8");
    expect((await new BoardStore(directory).list("project-1")).map((entry) => entry.id)).toEqual(["a"]);
  });

  it("retries a failed folder read instead of caching the rejected promise", async () => {
    const file = path.join(directory, "project-1.jsonl");
    await fs.mkdir(file);
    const store = new BoardStore(directory);
    await expect(store.list("project-1")).rejects.toThrow();
    await fs.rmdir(file);
    await fs.writeFile(file, JSON.stringify({ type: "message", message: message("retry") }) + "\n");
    expect((await store.list("project-1"))[0].id).toBe("retry");
  });

  it("keeps the last 500 messages and compacts a file that grew far past them", async () => {
    const lines = Array.from({ length: 2100 }, (_, index) => JSON.stringify({ type: "message", message: message(`m${index}`) }));
    await fs.writeFile(path.join(directory, "project-1.jsonl"), `${lines.join("\n")}\n`, "utf8");
    const messages = await new BoardStore(directory).list("project-1");
    expect(messages).toHaveLength(500);
    expect(messages[0].id).toBe("m1600");
    const compacted = (await fs.readFile(path.join(directory, "project-1.jsonl"), "utf8")).trim().split("\n");
    expect(compacted).toHaveLength(500);
  });

  it("never lets a project id name a path outside the directory", async () => {
    const store = new BoardStore(directory);
    await store.append(message("a", { projectId: "../escape" }));
    expect(await fs.readdir(directory)).toEqual(["___escape.jsonl"]);
  });
});
