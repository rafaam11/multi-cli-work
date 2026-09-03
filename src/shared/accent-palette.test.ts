import { describe, expect, it } from "vitest";
import { ACCENT_COLOR_COUNT, ACCENT_INDEXES, accentClass } from "./accent-palette";

describe("accentClass", () => {
  it("1..7을 accent-n 클래스로 매핑한다", () => {
    expect(accentClass(1)).toBe("accent-1");
    expect(accentClass(7)).toBe("accent-7");
  });

  it("범위 밖 값은 마지막 그물로 accent-1에 접는다", () => {
    expect(accentClass(0)).toBe("accent-1");
    expect(accentClass(8)).toBe("accent-1");
    expect(accentClass(1.5)).toBe("accent-1");
    expect(accentClass(NaN)).toBe("accent-1");
  });

  it("ACCENT_INDEXES는 1부터 7까지다", () => {
    expect(ACCENT_INDEXES).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("ACCENT_COLOR_COUNT는 7이다", () => {
    expect(ACCENT_COLOR_COUNT).toBe(7);
  });
});
