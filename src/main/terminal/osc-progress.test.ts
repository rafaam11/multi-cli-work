import { describe, expect, it } from "vitest";
import { createOscProgressScanner } from "./osc-progress";

const BEL = "\u0007";
const ST = "\u001b\\";
const osc = (body: string, end = BEL) => `\u001b]9;4;${body}${end}`;

describe("createOscProgressScanner", () => {
  it("reads every ConEmu progress state", () => {
    const scanner = createOscProgressScanner();
    expect(scanner.scan(osc("1;40"))).toEqual([{ state: "normal", value: 40 }]);
    expect(scanner.scan(osc("2;70"))).toEqual([{ state: "error", value: 70 }]);
    expect(scanner.scan(osc("3;"))).toEqual([{ state: "indeterminate", value: null }]);
    expect(scanner.scan(osc("4;10"))).toEqual([{ state: "warning", value: 10 }]);
    expect(scanner.scan(osc("0"))).toEqual([null]);
    expect(scanner.scan(osc("0;0", ST))).toEqual([null]);
  });

  it("keeps every update of one chunk in order, among other output", () => {
    const scanner = createOscProgressScanner();
    expect(scanner.scan(`build ${osc("1;10")}\r\nstep ${osc("1;55", ST)} done ${osc("0")}`)).toEqual([
      { state: "normal", value: 10 },
      { state: "normal", value: 55 },
      null,
    ]);
  });

  it("joins a sequence split across chunks", () => {
    const scanner = createOscProgressScanner();
    expect(scanner.scan("text \u001b]9")).toEqual([]);
    expect(scanner.scan(";4;1;")).toEqual([]);
    expect(scanner.scan(`25${BEL} more`)).toEqual([{ state: "normal", value: 25 }]);
  });

  it("clamps the value, treats a missing value as none, and rounds fractions", () => {
    const scanner = createOscProgressScanner();
    expect(scanner.scan(osc("1;250"))).toEqual([{ state: "normal", value: 100 }]);
    expect(scanner.scan(osc("1"))).toEqual([{ state: "normal", value: 0 }]);
    expect(scanner.scan(osc("2"))).toEqual([{ state: "error", value: null }]);
    expect(scanner.scan(osc("1;33.6"))).toEqual([{ state: "normal", value: 34 }]);
  });

  it("ignores other OSC 9 commands, unknown states and garbage", () => {
    const scanner = createOscProgressScanner();
    expect(scanner.scan(`\u001b]9;9;C:\\dev${BEL}\u001b]9;done${BEL}${osc("7;1")}${osc("x")}`)).toEqual([]);
  });

  it("drops an unterminated sequence that grows past its bound instead of buffering forever", () => {
    const scanner = createOscProgressScanner();
    expect(scanner.scan(`\u001b]9;4;1;${"9".repeat(200)}`)).toEqual([]);
    expect(scanner.scan(`${BEL}${osc("1;5")}`)).toEqual([{ state: "normal", value: 5 }]);
  });
});
