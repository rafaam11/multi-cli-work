// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { createRetryableDisposer } from "./runtime-disposal";

describe("runtime disposal", () => {
  it("retries from a failed stage without repeating completed stages", async () => {
    const first = vi.fn();
    const second = vi.fn()
      .mockRejectedValueOnce(new Error("shutdown failed"))
      .mockResolvedValueOnce(undefined);
    const third = vi.fn();
    const dispose = createRetryableDisposer([first, second, third]);

    await expect(dispose()).rejects.toThrow("shutdown failed");
    await expect(dispose()).resolves.toBeUndefined();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
    expect(third).toHaveBeenCalledOnce();
  });

  it("shares one in-flight attempt between concurrent callers", async () => {
    let release!: () => void;
    const stage = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const dispose = createRetryableDisposer([stage]);

    const first = dispose();
    const second = dispose();
    expect(stage).toHaveBeenCalledOnce();
    release();
    await Promise.all([first, second]);
  });
});
