import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "./linear-client";
import type { LinearKeyStore } from "./linear-key-store";
import { createLinearService } from "./linear-service";

function memoryStore(initial: string | null = null): LinearKeyStore & { written: string[] } {
  let key = initial;
  const written: string[] = [];
  return {
    written,
    encryptionAvailable: () => true,
    read: async () => key,
    write: async (value) => {
      written.push(value);
      key = value;
    },
    clear: async () => {
      key = null;
    },
  };
}

function okResponse(): Response {
  const project = {
    name: "PRJ-0017 세컨드브레인",
    url: "https://linear.app/ws/project/x",
    projectUpdates: { nodes: [] },
    issues: { nodes: [{ identifier: "SB-1", title: "할 일", dueDate: null, priority: 0, state: { name: "할 일", type: "unstarted" }, labels: { nodes: [] }, comments: { nodes: [] } }] },
  };
  return new Response(JSON.stringify({ data: { projects: { nodes: [project] }, viewer: { id: "u" } } }), { status: 200 });
}

const input = { prjKey: "PRJ-0017", repoName: "multi-cli-work", recordReminder: false };

describe("LinearService", () => {
  it("returns null without a key and never calls fetch", async () => {
    const fetch = vi.fn<FetchLike>(async () => okResponse());
    const service = createLinearService(memoryStore(), { fetch });
    await expect(service.briefSection(input)).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns the rendered section and caches it for five minutes", async () => {
    let now = 1_000_000;
    const fetch = vi.fn<FetchLike>(async () => okResponse());
    const service = createLinearService(memoryStore("lin_api_x"), { fetch, now: () => now });
    const first = await service.briefSection(input);
    expect(first).toContain("## Linear 맥락 (PRJ-0017 세컨드브레인");
    expect(first).toContain("SB-1");
    await service.briefSection(input);
    expect(fetch).toHaveBeenCalledTimes(1);
    now += 300_001;
    await service.briefSection(input);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("briefSection returns null after the deadline", async () => {
    const fetch = vi.fn<FetchLike>(() => new Promise<Response>(() => undefined));
    const service = createLinearService(memoryStore("lin_api_x"), { fetch, deadlineMs: 50 });
    const started = Date.now();
    await expect(service.briefSection(input)).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("records and clears lastError", async () => {
    let fail = true;
    const fetch = vi.fn<FetchLike>(async () => (fail ? new Response("{}", { status: 401 }) : okResponse()));
    const service = createLinearService(memoryStore("lin_api_x"), { fetch, cacheTtlMs: 0 });
    await expect(service.briefSection(input)).resolves.toBeNull();
    expect((await service.status()).lastError).toBe("Linear API 키가 거부됐습니다");
    fail = false;
    await expect(service.briefSection(input)).resolves.not.toBeNull();
    expect((await service.status()).lastError).toBeNull();
  });

  it("setKey verifies before writing", async () => {
    const store = memoryStore();
    const fetch = vi.fn<FetchLike>(async () => new Response("{}", { status: 401 }));
    const service = createLinearService(store, { fetch });
    await expect(service.setKey("bad")).rejects.toThrow("Linear API 키가 거부됐습니다");
    expect(store.written).toEqual([]);
  });

  it("setKey and clearKey drop the cache", async () => {
    const fetch = vi.fn<FetchLike>(async () => okResponse());
    const service = createLinearService(memoryStore("lin_api_x"), { fetch });
    await service.briefSection(input);
    await service.setKey("lin_api_y");
    await service.briefSection(input);
    const projectCalls = () => fetch.mock.calls.filter(([, init]) => String(init.body).includes("projects")).length;
    expect(projectCalls()).toBe(2);
    await service.clearKey();
    await expect(service.briefSection(input)).resolves.toBeNull();
    expect((await service.status()).configured).toBe(false);
  });
});
