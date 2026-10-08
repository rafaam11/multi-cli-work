import { describe, expect, it } from "vitest";
import { startSize } from "./initial-size";

describe("startSize", () => {
  it("reuses what the session screen measured in the same layout", () => {
    expect(
      startSize({ measured: { cols: 150, rows: 40, wide: true }, wide: true, viewport: { width: 1024, height: 768 } }),
    ).toEqual({ cols: 150, rows: 40 });
  });

  it("estimates from the window when nothing was measured in this layout", () => {
    // 넓은 화면: 목록 281px과 여백 8px을 빼고, 머리줄·도구줄을 뺀 영역을 12px 글자(7.2×14.4)로 나눈다.
    expect(startSize({ measured: null, wide: true, viewport: { width: 1024, height: 768 } })).toEqual({ cols: 102, rows: 45 });
    // 폰을 돌려 배치가 바뀌었으면 이전 측정은 쓰지 않는다.
    expect(
      startSize({ measured: { cols: 150, rows: 40, wide: true }, wide: false, viewport: { width: 412, height: 915 } }),
    ).toEqual({ cols: 56, rows: 48 });
  });

  it("gives up on a viewport too small to hold a terminal", () => {
    expect(startSize({ measured: null, wide: false, viewport: { width: 0, height: 0 } })).toBeNull();
  });
});
