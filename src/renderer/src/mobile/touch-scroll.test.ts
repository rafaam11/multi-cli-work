import { describe, expect, it } from "vitest";
import { planTouchScroll } from "./touch-scroll";

const CELL = 10;
const state = (overrides: Partial<Parameters<typeof planTouchScroll>[0]> = {}) => ({
  containerTop: 0,
  containerMax: 0,
  viewportY: 100,
  baseY: 100,
  ...overrides,
});

describe("planTouchScroll", () => {
  it("dragging down first scrolls the oversized container back to its top", () => {
    expect(planTouchScroll(state({ containerTop: 30, containerMax: 200 }), 20, CELL, 0)).toEqual({
      containerDelta: -20,
      lines: 0,
      remainder: 0,
    });
  });

  it("dragging down past the container top scrolls the terminal back by whole lines, carrying the rest", () => {
    expect(planTouchScroll(state({ containerTop: 5, containerMax: 200 }), 30, CELL, 0)).toEqual({
      containerDelta: -5,
      lines: -2,
      remainder: 5,
    });
  });

  it("a phone-sized terminal (no container overflow) scrolls its scrollback", () => {
    expect(planTouchScroll(state(), 25, CELL, 0)).toEqual({ containerDelta: 0, lines: -2, remainder: 5 });
    expect(planTouchScroll(state(), 6, CELL, 5)).toEqual({ containerDelta: 0, lines: -1, remainder: 1 });
  });

  it("stops at the top of the scrollback", () => {
    expect(planTouchScroll(state({ viewportY: 1 }), 50, CELL, 0)).toEqual({ containerDelta: 0, lines: -1, remainder: 0 });
    expect(planTouchScroll(state({ viewportY: 0 }), 50, CELL, 0)).toEqual({ containerDelta: 0, lines: 0, remainder: 0 });
  });

  it("dragging up scrolls the terminal forward until it reaches the live bottom", () => {
    expect(planTouchScroll(state({ viewportY: 90 }), -25, CELL, 0)).toEqual({ containerDelta: 0, lines: 2, remainder: -5 });
  });

  it("dragging up at the live bottom moves the oversized container instead", () => {
    expect(planTouchScroll(state({ containerTop: 0, containerMax: 200 }), -40, CELL, 0)).toEqual({
      containerDelta: 40,
      lines: 0,
      remainder: 0,
    });
    expect(planTouchScroll(state({ viewportY: 99, containerTop: 190, containerMax: 200 }), -40, CELL, 0)).toEqual({
      containerDelta: 10,
      lines: 1,
      remainder: 0,
    });
  });

  it("a sub-line drag only accumulates", () => {
    expect(planTouchScroll(state(), 4, CELL, 0)).toEqual({ containerDelta: 0, lines: 0, remainder: 4 });
  });

  describe("unbounded (full-screen apps like claude scroll themselves)", () => {
    const alt = (overrides: Partial<Parameters<typeof planTouchScroll>[0]> = {}) => state({ viewportY: 0, baseY: 0, unbounded: true, ...overrides });

    it("turns the whole drag into steps even with no xterm scrollback", () => {
      expect(planTouchScroll(alt(), 25, CELL, 0)).toEqual({ containerDelta: 0, lines: -2, remainder: 5 });
      expect(planTouchScroll(alt(), -25, CELL, 0)).toEqual({ containerDelta: 0, lines: 2, remainder: -5 });
    });

    it("still moves an oversized container first, in both directions", () => {
      expect(planTouchScroll(alt({ containerTop: 5, containerMax: 200 }), 30, CELL, 0)).toEqual({
        containerDelta: -5,
        lines: -2,
        remainder: 5,
      });
      expect(planTouchScroll(alt({ containerTop: 190, containerMax: 200 }), -30, CELL, 0)).toEqual({
        containerDelta: 10,
        lines: 2,
        remainder: 0,
      });
    });
  });
});
