// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { TerminalSessionView } from "../../shared/api-types";
import type { TerminalEvent } from "../../shared/terminal-types";
import type { HumanDraft } from "../terminal/human-input-tracker";
import { DeliveryQueue, HELD_CHIP_KEY, sanitizeDeliveryText, sessionLabel } from "./delivery-queue";

function session(overrides: Partial<TerminalSessionView>): TerminalSessionView {
  return {
    id: "target",
    projectId: "project-1",
    tool: null,
    title: null,
    name: null,
    kind: "codex",
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

function harness(initial: TerminalSessionView[] = [session({}), session({ id: "sender", name: "빌더", kind: "claude" })]) {
  let now = 100_000;
  let sessions = initial;
  const drafts = new Map<string, HumanDraft>();
  const eventListeners = new Set<(event: TerminalEvent) => void>();
  const draftListeners = new Set<(sessionId: string) => void>();
  let tick: (() => void) | null = null;
  let ids = 0;
  const write = vi.fn(async (_sessionId: string, _data: string) => undefined);
  const setChip = vi.fn();
  const clearChips = vi.fn();
  const queue = new DeliveryQueue({
    sessions: () => sessions,
    write,
    onEvent: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    draft: (sessionId) => drafts.get(sessionId) ?? { length: 0, lastInputAt: null },
    onDraftChange: (listener) => {
      draftListeners.add(listener);
      return () => draftListeners.delete(listener);
    },
    setChip,
    clearChips,
    idFactory: () => `m${(ids += 1)}`,
    now: () => now,
    setInterval: (callback) => {
      tick = callback;
      return 1;
    },
    clearInterval: () => {
      tick = null;
    },
  });
  return {
    queue,
    write,
    setChip,
    clearChips,
    setSessions(next: TerminalSessionView[]) {
      sessions = next;
    },
    setStatus(status: TerminalSessionView["status"], id = "target") {
      sessions = sessions.map((candidate) => (candidate.id === id ? { ...candidate, status } : candidate));
      for (const listener of eventListeners) listener({ type: "status", sessionId: id, status });
    },
    output(id = "target") {
      for (const listener of eventListeners) listener({ type: "data", sessionId: id, data: "x", sequence: 1 });
    },
    type(length: number, id = "target") {
      drafts.set(id, { length, lastInputAt: now });
      for (const listener of draftListeners) listener(id);
    },
    advance(ms: number) {
      now += ms;
    },
    async tick() {
      tick?.();
      // Let the pass the ticker started finish, writes and all.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    hasTicker: () => tick !== null,
  };
}

describe("DeliveryQueue", () => {
  it("delivers at once to an idle target, with the sender's name in front", async () => {
    const h = harness();
    const result = await h.queue.enqueue({ to: "target", text: "리뷰해 줘", from: "sender" });
    expect(result).toMatchObject({ state: "delivered", to: "target", text: "리뷰해 줘" });
    expect(h.write).toHaveBeenCalledWith("target", "[from 빌더 (claude)] 리뷰해 줘\r");
    expect(h.clearChips).toHaveBeenCalledWith("target", HELD_CHIP_KEY);
  });

  it("uses a label or no prefix when asked, and wraps multiline text in one paste", async () => {
    const h = harness();
    await h.queue.enqueue({ to: "target", text: "a", label: "board: 나" });
    expect(h.write).toHaveBeenLastCalledWith("target", "[board: 나] a\r");
    h.advance(5000);
    await h.queue.enqueue({ to: "target", text: "첫 줄\n둘째 줄", from: "sender", raw: true });
    expect(h.write).toHaveBeenLastCalledWith("target", "\u001b[200~첫 줄\n둘째 줄\u001b[201~\r");
  });

  it("holds while the target works and delivers once its turn ends", async () => {
    const h = harness([session({ status: "working" })]);
    const result = await h.queue.enqueue({ to: "target", text: "x" });
    expect(result).toMatchObject({ state: "held", reason: "working" });
    expect(h.write).not.toHaveBeenCalled();
    expect(h.setChip).toHaveBeenCalledWith("target", { key: HELD_CHIP_KEY, text: "보류 1", color: "amber" });

    h.setStatus("awaiting-input");
    await h.queue.pump();
    expect(h.write).toHaveBeenCalledWith("target", "x\r");
    expect(h.queue.get(result.id)).toMatchObject({ state: "delivered" });
  });

  it("--now skips the turn but never an approval prompt or a person typing", async () => {
    const h = harness([session({ status: "working" })]);
    expect(await h.queue.enqueue({ to: "target", text: "x", urgent: true })).toMatchObject({ state: "delivered" });

    h.advance(5000);
    h.setStatus("awaiting-approval");
    expect(await h.queue.enqueue({ to: "target", text: "y", urgent: true })).toMatchObject({
      state: "held",
      reason: "awaiting-approval",
    });
  });

  it("holds while a person types, until the draft is sent and the keyboard goes quiet", async () => {
    const h = harness();
    h.type(5);
    const result = await h.queue.enqueue({ to: "target", text: "x" });
    expect(result).toMatchObject({ state: "held", reason: "typing" });

    h.type(0);
    await h.queue.pump();
    expect(h.write).not.toHaveBeenCalled();
    h.advance(3100);
    await h.tick();
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it("waits for the screen to settle so a CLI still drawing its first screen is not typed into", async () => {
    const h = harness();
    h.output();
    expect(await h.queue.enqueue({ to: "target", text: "x" })).toMatchObject({ state: "held", reason: "settling" });
    h.advance(1300);
    await h.tick();
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it("sends one message per target at a time, in order, with a gap between them", async () => {
    const h = harness([session({ status: "working" })]);
    await h.queue.enqueue({ to: "target", text: "first" });
    await h.queue.enqueue({ to: "target", text: "second" });
    expect(h.setChip).toHaveBeenLastCalledWith("target", { key: HELD_CHIP_KEY, text: "보류 2", color: "amber" });

    h.setStatus("idle");
    await h.queue.pump();
    expect(h.write.mock.calls.map(([, data]) => data)).toEqual(["first\r"]);
    h.advance(3000);
    await h.tick();
    expect(h.write.mock.calls.map(([, data]) => data)).toEqual(["first\r", "second\r"]);
    expect(h.hasTicker()).toBe(false);
  });

  it("fails everything held for a target that exits, and what waits too long", async () => {
    const h = harness([session({ status: "working" }), session({ id: "other", status: "working" })]);
    const a = await h.queue.enqueue({ to: "target", text: "a" });
    const b = await h.queue.enqueue({ to: "target", text: "b" });
    const c = await h.queue.enqueue({ to: "other", text: "c" });
    h.setStatus("exited");
    await h.queue.pump();
    expect(h.queue.get(a.id)).toMatchObject({ state: "failed" });
    expect(h.queue.get(b.id)).toMatchObject({ state: "failed" });
    expect(h.queue.get(c.id)).toMatchObject({ state: "held" });

    h.advance(31 * 60_000);
    await h.tick();
    expect(h.queue.get(c.id)).toMatchObject({ state: "failed", reason: "보류 시간 초과" });
  });

  it("drops a held message, lists what is held, and resolves waiters when it settles", async () => {
    const h = harness([session({ status: "working" })]);
    const kept = await h.queue.enqueue({ to: "target", text: "keep" });
    const dropped = await h.queue.enqueue({ to: "target", text: "drop" });
    expect(h.queue.held("target").map((record) => record.id)).toEqual([kept.id, dropped.id]);
    expect(h.queue.drop(dropped.id)).toMatchObject({ state: "dropped" });
    expect(h.queue.drop(dropped.id)).toBeNull();

    const waiting = h.queue.waitFor(kept.id, 10_000);
    h.setStatus("idle");
    await h.queue.pump();
    await expect(waiting).resolves.toMatchObject({ state: "delivered" });
  });

  it("tells listeners about every change", async () => {
    const h = harness([session({ status: "working" })]);
    const seen: string[] = [];
    h.queue.onChange((record) => seen.push(`${record.state}:${record.reason ?? ""}`));
    await h.queue.enqueue({ to: "target", text: "x" });
    h.setStatus("idle");
    await h.queue.pump();
    expect(seen).toEqual(["held:working", "delivered:"]);
  });
});

describe("sanitizeDeliveryText", () => {
  it("removes escape sequences and control characters but keeps newlines and tabs", () => {
    expect(sanitizeDeliveryText("a\u001b[201~b\u001b[31mc\u0007\td\r\ne")).toBe("abc\td\ne");
  });
});

describe("sessionLabel", () => {
  it("prefers the name, then the title, then kind and a short id", () => {
    expect(sessionLabel({ id: "abcdef", name: "빌더", title: "t", kind: "claude" })).toBe("빌더");
    expect(sessionLabel({ id: "abcdef", name: null, title: "제목", kind: "claude" })).toBe("제목");
    expect(sessionLabel({ id: "abcdef", name: " ", title: null, kind: "codex" })).toBe("codex-abcd");
  });
});
