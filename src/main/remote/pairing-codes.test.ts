// @vitest-environment node

import { describe, expect, it } from "vitest";
import { formatPairingCode, PairingCodes } from "./pairing-codes";

function codes(start = 0) {
  let now = start;
  const pairing = new PairingCodes({ now: () => now, randomCode: () => "ABCDEFGH" });
  return { pairing, advance: (ms: number) => (now += ms) };
}

describe("PairingCodes", () => {
  it("accepts the code once, ignoring case and the hyphen", () => {
    const { pairing } = codes();
    expect(pairing.issue().code).toBe("ABCD-EFGH");
    expect(pairing.consume("abcd-efgh", "100.1.1.1")).toBe("ok");
    expect(pairing.consume("ABCDEFGH", "100.1.1.1")).toBe("invalid");
  });

  it("expires after five minutes", () => {
    const { pairing, advance } = codes();
    pairing.issue();
    advance(5 * 60_000 + 1);
    expect(pairing.consume("ABCDEFGH", "100.1.1.1")).toBe("invalid");
  });

  it("a new code replaces the previous one", () => {
    let next = "AAAAAAAA";
    const pairing = new PairingCodes({ now: () => 0, randomCode: () => next });
    pairing.issue();
    next = "BBBBBBBB";
    pairing.issue();
    expect(pairing.consume("AAAAAAAA", "ip")).toBe("invalid");
    expect(pairing.consume("BBBBBBBB", "ip")).toBe("ok");
  });

  it("rate-limits an address after five failures in a minute, then forgives it", () => {
    const { pairing, advance } = codes();
    pairing.issue();
    for (let i = 0; i < 5; i += 1) expect(pairing.consume("WRONG", "100.1.1.1")).toBe("invalid");
    expect(pairing.consume("ABCDEFGH", "100.1.1.1")).toBe("rate-limited");
    expect(pairing.consume("ABCDEFGH", "100.2.2.2")).toBe("ok");
    pairing.issue();
    advance(60_001);
    expect(pairing.consume("ABCDEFGH", "100.1.1.1")).toBe("ok");
  });

  it("burns the code after ten failures from anywhere", () => {
    const { pairing } = codes();
    pairing.issue();
    for (let i = 0; i < 10; i += 1) pairing.consume("WRONG", `100.0.0.${i}`);
    expect(pairing.consume("ABCDEFGH", "100.9.9.9")).toBe("invalid");
  });

  it("formats a raw code for display", () => {
    expect(formatPairingCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });
});
