// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { TerminalSessionView } from "../../shared/api-types";
import type { BoardMessage, BoardRecipient } from "../../shared/board-types";
import type { DeliveryRecord, DeliveryRequest } from "../control/delivery-queue";
import { BoardService } from "./board-service";

function session(overrides: Partial<TerminalSessionView>): TerminalSessionView {
  return {
    id: "builder",
    projectId: "project-1",
    tool: null,
    title: null,
    name: "빌더",
    kind: "claude",
    cwd: "C:\\Work",
    providerConversationId: null,
    interruptedByShutdown: false,
    status: "idle",
    pid: 100,
    exitCode: null,
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
    ...overrides,
  };
}

function memoryStore() {
  const boards = new Map<string, BoardMessage[]>();
  return {
    list: vi.fn(async (projectId: string) => [...(boards.get(projectId) ?? [])]),
    append: vi.fn(async (message: BoardMessage) => {
      boards.set(message.projectId, [...(boards.get(message.projectId) ?? []), message]);
    }),
    patch: vi.fn(async (projectId: string, id: string, to: BoardRecipient[]) => {
      const list = boards.get(projectId) ?? [];
      const index = list.findIndex((message) => message.id === id);
      if (index < 0) return null;
      list[index] = { ...list[index], to };
      return list[index];
    }),
  };
}

function harness(state: DeliveryRecord["state"] = "held") {
  const sessions = [
    session({}),
    session({ id: "reviewer", name: "리뷰어", kind: "codex" }),
    session({ id: "elsewhere", name: "다른 폴더", projectId: "project-2" }),
  ];
  const deliveryListeners = new Set<(record: DeliveryRecord) => void>();
  let ids = 0;
  const enqueue = vi.fn(async (request: DeliveryRequest): Promise<DeliveryRecord> => ({
    id: `d${(ids += 1)}`,
    from: request.from ?? null,
    to: request.to,
    text: request.text,
    state,
    reason: state === "held" ? "working" : null,
    createdAt: 0,
    settledAt: null,
  }));
  const published: BoardMessage[] = [];
  const store = memoryStore();
  let messageIds = 0;
  const service = new BoardService({
    store,
    delivery: {
      enqueue,
      onChange: (listener) => {
        deliveryListeners.add(listener);
        return () => deliveryListeners.delete(listener);
      },
    },
    sessions: () => sessions,
    idFactory: () => `b${(messageIds += 1)}`,
    now: () => "2026-10-18T01:00:00.000Z",
    publish: (message) => published.push(message),
  });
  return {
    service,
    enqueue,
    published,
    store,
    async deliver(record: Partial<DeliveryRecord> & { id: string; to: string }) {
      for (const listener of deliveryListeners) {
        listener({ from: null, text: "", state: "delivered", reason: null, createdAt: 0, settledAt: 1, ...record });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe("BoardService.post", () => {
  it("records per-recipient edits even when delivery state is unchanged without rewriting the post", async () => {
    const h = harness();
    await h.service.post({ projectId: "project-1", text: "original", mentions: ["reviewer", "elsewhere"], from: "builder" });
    await h.deliver({ id: "d1", to: "reviewer", text: "revised", state: "held", reason: "working" });
    const [stored] = await h.service.list("project-1");
    expect(stored.text).toBe("original");
    expect(stored.to[0]).toMatchObject({ deliveryText: "revised", delivery: "held" });
    expect(stored.to[1]).toMatchObject({ deliveryText: "original" });
    await h.deliver({ id: "d1", to: "reviewer", text: "revised", state: "delivered" });
    expect((await h.service.list("project-1"))[0].to[0]).toMatchObject({ deliveryText: "revised", delivery: "delivered" });
  });
  it("writes the post, types it into each mentioned session with a board label, and tracks delivery", async () => {
    const h = harness();
    const posted = await h.service.post({ projectId: "project-1", text: "  검토 부탁  ", mentions: ["reviewer"], from: "builder" });

    expect(posted).toMatchObject({
      kind: "post",
      text: "검토 부탁",
      author: { kind: "session", sessionId: "builder", name: "빌더", agent: "claude" },
      to: [{ sessionId: "reviewer", name: "리뷰어", delivery: "held", reason: "working", deliveryId: "d1" }],
    });
    expect(h.enqueue).toHaveBeenCalledWith({ to: "reviewer", text: "검토 부탁", from: "builder", label: "board: 빌더" });

    await h.deliver({ id: "d1", to: "reviewer" });
    const [stored] = await h.service.list("project-1");
    expect(stored.to[0]).toMatchObject({ delivery: "delivered", reason: null });
    expect(h.published.at(-1)?.to[0].delivery).toBe("delivered");
  });

  it("posts as the user from the board, ignores a self-mention, and refuses empty or unknown input", async () => {
    const h = harness();
    await h.service.post({ projectId: "project-1", text: "모두 확인", mentions: ["reviewer"], from: null });
    expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({ label: "board: 나", from: null }));

    const self = await h.service.post({ projectId: "project-1", text: "x", mentions: ["builder"], from: "builder" });
    expect(self.to).toEqual([]);

    await expect(h.service.post({ projectId: "project-1", text: "   ", mentions: [], from: null })).rejects.toThrow("비어");
    await expect(h.service.post({ projectId: "project-1", text: "x", mentions: ["ghost"], from: null })).rejects.toThrow("ghost");
  });

  it("applies progress that arrived before the post finished writing", async () => {
    const h = harness();
    // The queue settles the delivery the moment it is created — before the board has tracked it.
    h.enqueue.mockImplementationOnce(async (request) => {
      await h.deliver({ id: "early", to: request.to });
      return { id: "early", from: null, to: request.to, text: request.text, state: "held", reason: "working", createdAt: 0, settledAt: null };
    });
    await h.service.post({ projectId: "project-1", text: "x", mentions: ["reviewer"], from: null });
    const [stored] = await h.service.list("project-1");
    expect(stored.to[0]).toMatchObject({ delivery: "delivered", deliveryId: "early" });
  });
});

describe("BoardService.recordDirect", () => {
  const record = (overrides: Partial<DeliveryRecord>): DeliveryRecord => ({
    id: "d9",
    from: "builder",
    to: "reviewer",
    text: "diff 봐줘",
    state: "held",
    reason: "working",
    createdAt: 0,
    settledAt: null,
    ...overrides,
  });

  it("records a send between two sessions and follows its delivery", async () => {
    const h = harness();
    await h.service.recordDirect(record({}));
    const [direct] = await h.service.list("project-1");
    expect(direct).toMatchObject({
      kind: "direct",
      author: { kind: "session", name: "빌더" },
      to: [{ sessionId: "reviewer", delivery: "held", deliveryId: "d9" }],
      text: "diff 봐줘",
    });
    await h.deliver({ id: "d9", to: "reviewer", state: "failed", reason: "대상 세션이 종료됐습니다" });
    expect((await h.service.list("project-1"))[0].to[0]).toMatchObject({ delivery: "failed", reason: "대상 세션이 종료됐습니다" });
  });

  it("puts a send across folders on both boards, and one from outside the app as the app's", async () => {
    const h = harness();
    await h.service.recordDirect(record({ to: "elsewhere" }));
    expect(await h.service.list("project-1")).toHaveLength(1);
    expect(await h.service.list("project-2")).toHaveLength(1);

    await h.service.recordDirect(record({ id: "d10", from: null }), "첫 프롬프트");
    const last = (await h.service.list("project-1")).at(-1);
    expect(last).toMatchObject({ author: { kind: "system" }, text: "첫 프롬프트\ndiff 봐줘" });
  });

  it("lists after a message id and by the last N", async () => {
    const h = harness();
    await h.service.event("project-1", "one");
    await h.service.event("project-1", "two");
    await h.service.event("project-1", "three");
    expect((await h.service.list("project-1", { sinceId: "b1" })).map((message) => message.text)).toEqual(["two", "three"]);
    expect((await h.service.list("project-1", { limit: 1 })).map((message) => message.text)).toEqual(["three"]);
  });
});
