// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { QuitCoordinator } from "./quit-coordinator";

describe("QuitCoordinator", () => {
  it("shares concurrent quit/update requests and awaits disposal exactly once", async () => {
    let finishDispose!: () => void;
    const dispose = vi.fn(() => new Promise<void>((resolve) => { finishDispose = resolve; }));
    const coordinator = new QuitCoordinator(dispose);
    const quit = vi.fn();
    const update = vi.fn();

    const first = coordinator.request({ confirm: async () => true, exit: quit });
    const second = coordinator.request({ confirm: async () => true, exit: update });
    await Promise.resolve();

    expect(dispose).toHaveBeenCalledOnce();
    expect(quit).not.toHaveBeenCalled();
    finishDispose();
    await Promise.all([first, second]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
    expect(update).not.toHaveBeenCalled();
    expect(coordinator.isCommitted()).toBe(true);
  });

  it("allows a later request after confirmation is cancelled", async () => {
    const dispose = vi.fn().mockResolvedValue(undefined);
    const coordinator = new QuitCoordinator(dispose);
    await coordinator.request({ confirm: async () => false, exit: vi.fn() });
    const exit = vi.fn();

    await coordinator.request({ confirm: async () => true, exit });

    expect(dispose).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });
});
