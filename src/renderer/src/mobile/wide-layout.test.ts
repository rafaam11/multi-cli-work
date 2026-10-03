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
    expect(sessionIdFromHash("")).toBeNull();
    expect(sessionIdFromHash("#session=")).toBeNull();
    expect(sessionIdFromHash("#terminal")).toBeNull();
  });
});
