import { describe, expect, it } from "vitest";
import { sessionIdFromHash, WIDE_LAYOUT_QUERY } from "./wide-layout";

describe("wide layout", () => {
  it("is for a wide screen with a mouse", () => {
    expect(WIDE_LAYOUT_QUERY).toBe("(min-width: 900px) and (pointer: fine)");
  });

  it("reads the session a link points at", () => {
    expect(sessionIdFromHash("#session=abc-123")).toBe("abc-123");
    expect(sessionIdFromHash("#session=a%20b")).toBe("a b");
    expect(sessionIdFromHash("#other=1&session=s2")).toBe("s2");
    // 셸은 같은 세션을 다시 가리킬 때 주소가 달라지도록 번호를 덧붙인다.
    expect(sessionIdFromHash("#session=s2&n=7")).toBe("s2");
    expect(sessionIdFromHash("")).toBeNull();
    expect(sessionIdFromHash("#session=")).toBeNull();
    expect(sessionIdFromHash("#terminal")).toBeNull();
  });
});
