// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import type { CreateTerminalInput, TerminalSessionView } from "../../shared/api-types";
import type { DeliveryRecord, DeliveryRequest } from "../control/delivery-queue";
import { launchPreset } from "./preset-service";
import { BUILTIN_PRESETS } from "./preset-registry";

function harness() {
  const order: string[] = [];
  const create = vi.fn(async (input: CreateTerminalInput) => {
    order.push(`create:${input.name}`);
    return { id: `s-${input.name}`, name: input.name ?? null, kind: input.kind, projectId: input.projectId } as TerminalSessionView;
  });
  const enqueue = vi.fn(async (request: DeliveryRequest): Promise<DeliveryRecord> => {
    order.push(`prompt:${request.to}`);
    return { id: `d-${request.to}`, from: null, to: request.to, text: request.text, state: "held", reason: "starting", createdAt: 0, settledAt: null };
  });
  const event = vi.fn(async (_projectId: string, text: string) => {
    order.push(`event:${text}`);
    return {} as never;
  });
  const recordDirect = vi.fn(async () => undefined);
  return { order, create, enqueue, event, recordDirect, options: { presets: async () => [...BUILTIN_PRESETS], create, delivery: { enqueue }, board: { event, recordDirect } } };
}

describe("launchPreset", () => {
  it("passes each member's explicit profile or native-default choice to creation", async () => {
    const h = harness();
    h.options.presets = async () => [{ ...BUILTIN_PRESETS[0], members: [{ agentId: "claude", name: "One", launchProfileId: "deep" }, { agentId: "codex", name: "Two", launchProfileId: null }] }];
    await launchPreset({ presetId: "builder-reviewer", projectId: "p1" }, h.options);
    expect(h.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ launchProfileId: "deep" }));
    expect(h.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ launchProfileId: null }));
  });
  it("starts each member named, notes it on the board, then queues each role prompt raw", async () => {
    const h = harness();
    const sessions = await launchPreset({ presetId: "builder-reviewer", projectId: "p1", worktreeId: "w1" }, h.options);

    expect(sessions.map((session) => session.id)).toEqual(["s-빌더", "s-리뷰어"]);
    expect(h.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ projectId: "p1", kind: "claude", worktreeId: "w1", name: "빌더", background: true }));
    expect(h.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ kind: "codex", name: "리뷰어" }));
    expect(h.order).toEqual(["create:빌더", "create:리뷰어", "event:프리셋 ‘빌더 + 리뷰어’으로 빌더, 리뷰어 시작", "prompt:s-빌더", "prompt:s-리뷰어"]);
    expect(h.enqueue).toHaveBeenCalledWith(expect.objectContaining({ to: "s-빌더", raw: true }));
    expect(h.recordDirect).toHaveBeenCalledWith(expect.objectContaining({ to: "s-리뷰어" }), "역할 프롬프트");
  });

  it("refuses an unknown preset and stops at the first member that cannot start", async () => {
    const h = harness();
    await expect(launchPreset({ presetId: "nope", projectId: "p1" }, h.options)).rejects.toThrow("알 수 없는 프리셋");
    h.create.mockRejectedValueOnce(new Error("Unknown agent: claude"));
    await expect(launchPreset({ presetId: "builder-reviewer", projectId: "p1" }, h.options)).rejects.toThrow("Unknown agent");
    expect(h.enqueue).not.toHaveBeenCalled();
  });
});
