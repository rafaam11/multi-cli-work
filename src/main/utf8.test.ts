import { describe, expect, it } from "vitest";
import { tailOnUtf8Boundary } from "./utf8";

describe("tailOnUtf8Boundary", () => {
  it("advances past a split multi-byte Korean character to the next full character", () => {
    const buffer = Buffer.from("Hi가나다", "utf8");

    const result = tailOnUtf8Boundary(buffer, 8);

    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(8);
    expect(result.toString("utf8")).not.toContain("�");
    expect(result.toString("utf8")).toBe("나다");
  });

  it("advances the maximum 3 bytes past a split 4-byte emoji sequence", () => {
    const buffer = Buffer.from("AB\u{1F600}CD", "utf8");

    const result = tailOnUtf8Boundary(buffer, 5);

    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(5);
    expect(result.toString("utf8")).not.toContain("�");
    expect(result.toString("utf8")).toBe("CD");
  });

  it("does not adjust when the cut already lands on a character boundary", () => {
    const buffer = Buffer.from("Hi가나다", "utf8");

    const result = tailOnUtf8Boundary(buffer, 9);

    expect(result.toString("utf8")).toBe("가나다");
  });

  it("returns the buffer unchanged when its length is at or below maxBytes", () => {
    const buffer = Buffer.from("가나다", "utf8");

    expect(tailOnUtf8Boundary(buffer, buffer.length)).toBe(buffer);
    expect(tailOnUtf8Boundary(buffer, buffer.length + 10)).toBe(buffer);
  });

  it("returns an empty buffer when maxBytes is zero or negative", () => {
    const buffer = Buffer.from("가나다", "utf8");

    expect(tailOnUtf8Boundary(buffer, 0)).toEqual(Buffer.alloc(0));
    expect(tailOnUtf8Boundary(buffer, -1)).toEqual(Buffer.alloc(0));
  });

  it("trims pure ASCII content exactly at maxBytes with no adjustment", () => {
    const buffer = Buffer.from("0123456789", "utf8");

    const result = tailOnUtf8Boundary(buffer, 4);

    expect(result.toString("utf8")).toBe("6789");
  });
});
