import type { UsageSnapshot } from "@shared/usage-types";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UsageGauge } from "./UsageGauge";

afterEach(cleanup);

const snapshot: UsageSnapshot = {
  claude: {
    windows: [
      { kind: "5h", usedPercent: 42.4, resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString() },
      { kind: "weekly", usedPercent: 88, resetsAt: null },
    ],
    plan: "max",
    updatedAt: new Date().toISOString(),
  },
  codex: {
    windows: [{ kind: "weekly", usedPercent: 54, resetsAt: null }],
    plan: "prolite",
    updatedAt: new Date(Date.now() - 12 * 60_000).toISOString(),
  },
};

describe("UsageGauge", () => {
  it("draws one ring per window, coloured by how full it is, and names every figure", () => {
    const { container } = render(<UsageGauge usage={snapshot} onOpen={vi.fn()} />);
    const button = screen.getByRole("button", { name: /구독 사용량/ });
    expect(button.getAttribute("aria-label")).toBe("구독 사용량: Claude 5시간 42% · 주간 88%, Codex 주간 54%");
    const rings = container.querySelectorAll(".usage-ring");
    expect([...rings].map((ring) => ring.getAttribute("data-level"))).toEqual(["ok", "high", "ok"]);
    expect(container.querySelector(".usage-ring-value")?.getAttribute("stroke-dasharray")).toBe("42.4 100");
  });

  it("opens a popover with bars, reset times and freshness, asking for fresh figures", () => {
    const onOpen = vi.fn();
    render(<UsageGauge usage={snapshot} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /구독 사용량/ }));
    expect(onOpen).toHaveBeenCalledOnce();

    const popover = screen.getByRole("dialog", { name: "구독 사용량" });
    const claude = within(popover).getByRole("region", { name: "Claude 사용량" });
    expect(claude).toHaveTextContent("max");
    expect(claude).toHaveTextContent("5시간");
    expect(claude).toHaveTextContent("42%");
    expect(claude).toHaveTextContent(/2시간( \d+분)? 후 초기화|1시간 59분 후 초기화/);
    expect(within(popover).getByRole("region", { name: "Codex 사용량" })).toHaveTextContent("12분 전 갱신");

    fireEvent.keyDown(popover, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "구독 사용량" })).toBeNull();
  });

  it("draws nothing when no provider has figures", () => {
    const { container } = render(<UsageGauge usage={{ claude: null, codex: null }} onOpen={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
