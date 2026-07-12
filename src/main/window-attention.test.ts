import { describe, expect, it, vi } from "vitest";
import { applyWindowAttention } from "./window-attention";

describe("window attention", () => {
  it("prefixes the title and flashes until no unseen wait remains", () => {
    const window = { isDestroyed: () => false, setTitle: vi.fn(), flashFrame: vi.fn() };

    applyWindowAttention(window, "approval");
    applyWindowAttention(window, "none");

    expect(window.setTitle).toHaveBeenNthCalledWith(1, "! 멀티 터미널 작업기");
    expect(window.flashFrame).toHaveBeenNthCalledWith(1, true);
    expect(window.setTitle).toHaveBeenLastCalledWith("멀티 터미널 작업기");
    expect(window.flashFrame).toHaveBeenLastCalledWith(false);
  });
});
