// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderUsage } from "../../shared/usage-types";
import { parseUsageSnapshot, UsageService, type ClaudeReading } from "./usage-service";

const usage = (percent: number, kind: "5h" | "weekly" = "5h", resetsAt = "2026-10-09T05:00:00.000Z"): ProviderUsage => ({
  windows: [{ kind, usedPercent: percent, resetsAt }],
  plan: null,
  updatedAt: "2026-10-09T03:00:00.000Z",
});

function service(overrides: Partial<ConstructorParameters<typeof UsageService>[0]> = {}) {
  const claude = vi.fn(async (): Promise<ClaudeReading> => ({ kind: "ok", usage: usage(10) }));
  const codex = vi.fn(async () => usage(20, "weekly"));
  const notify = vi.fn();
  const write = vi.fn(async () => undefined);
  const instance = new UsageService({
    claude,
    codex,
    hasLiveClaudeSession: () => true,
    enabled: () => true,
    notifyEnabled: () => true,
    notify,
    store: { read: async () => null, write },
    ...overrides,
  });
  return { instance, claude, codex, notify, write };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-09T03:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("UsageService", () => {
  it("reads both providers on start, publishes, saves the snapshot, and polls every five minutes", async () => {
    const { instance, claude, codex, write } = service();
    const changes = vi.fn();
    instance.onChange(changes);
    await instance.start();
    expect(instance.snapshot()).toEqual({ claude: usage(10), codex: usage(20, "weekly") });
    expect(changes).toHaveBeenCalledWith(instance.snapshot());
    expect(write).toHaveBeenCalledWith(instance.snapshot());

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(claude).toHaveBeenCalledTimes(2);
    expect(codex).toHaveBeenCalledTimes(2);
    instance.stop();
  });

  it("shows the last saved snapshot until the first reading lands", async () => {
    const saved = { claude: usage(55), codex: null };
    const { instance } = service({
      store: { read: async () => saved, write: vi.fn(async () => undefined) },
      claude: async () => ({ kind: "unavailable" }),
      codex: async () => null,
    });
    await instance.start();
    expect(instance.snapshot()).toEqual(saved);
    instance.stop();
  });

  it("asks Claude only while a Claude session runs, and not more often than once a minute on demand", async () => {
    let live = false;
    const { instance, claude } = service({ hasLiveClaudeSession: () => live });
    await instance.start();
    expect(claude).toHaveBeenCalledTimes(1); // the first reading always happens
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(claude).toHaveBeenCalledTimes(1);
    live = true;
    await vi.advanceTimersByTimeAsync(61_000);
    await instance.refresh();
    expect(claude).toHaveBeenCalledTimes(2);
    await instance.refresh();
    expect(claude).toHaveBeenCalledTimes(2);
    instance.stop();
  });

  it("backs off after a failure and honours Retry-After", async () => {
    const readings: ClaudeReading[] = [{ kind: "retry", afterMs: 120_000 }, { kind: "ok", usage: usage(30) }];
    const claude = vi.fn(async () => readings.shift() ?? { kind: "ok" as const, usage: usage(30) });
    const { instance } = service({ claude });
    await instance.start();
    expect(instance.snapshot().claude).toBeNull();
    await vi.advanceTimersByTimeAsync(61_000);
    await instance.refresh();
    expect(claude).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await instance.refresh();
    expect(claude).toHaveBeenCalledTimes(2);
    expect(instance.snapshot().claude).toEqual(usage(30));
    instance.stop();
  });

  it("warns once per window when usage crosses 90%, again only after the window resets", async () => {
    const values = [usage(80), usage(91), usage(95), usage(92, "5h", "2026-10-09T10:00:00.000Z")];
    const claude = vi.fn(async (): Promise<ClaudeReading> => ({ kind: "ok", usage: values.shift() ?? usage(0) }));
    const { instance, notify } = service({ claude });
    await instance.start();
    for (let index = 0; index < 3; index += 1) await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenNthCalledWith(1, "claude", expect.objectContaining({ kind: "5h", usedPercent: 91 }));
    instance.stop();
  });

  it("does nothing while switched off", async () => {
    const { instance, claude, codex } = service({ enabled: () => false });
    await instance.start();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(claude).not.toHaveBeenCalled();
    expect(codex).not.toHaveBeenCalled();
    instance.stop();
  });
});

describe("parseUsageSnapshot", () => {
  it("reads a saved snapshot and drops what it does not recognise", () => {
    const text = JSON.stringify({
      claude: { windows: [{ kind: "5h", usedPercent: 12, resetsAt: null }, { kind: "?", usedPercent: 1 }], plan: "max", updatedAt: "t" },
      codex: "nonsense",
    });
    expect(parseUsageSnapshot(text)).toEqual({
      claude: { windows: [{ kind: "5h", usedPercent: 12, resetsAt: null }], plan: "max", updatedAt: "t" },
      codex: null,
    });
    expect(parseUsageSnapshot("{broken")).toBeNull();
  });
});
