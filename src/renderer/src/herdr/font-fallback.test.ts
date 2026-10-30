import { describe, expect, it } from "vitest";
import { withKoreanFallback } from "./font-fallback";

describe("offline Korean font fallback",()=>{
  it("keeps the user's face before the fallback and the generic family last",()=>{
    expect(withKoreanFallback('"My Font", Consolas, monospace')).toBe('"My Font", Consolas, "MCW Noto Sans KR", monospace');
    expect(withKoreanFallback('"Name, With Comma", system-ui')).toBe('"Name, With Comma", "MCW Noto Sans KR", system-ui');
    expect(withKoreanFallback('D2Coding')).toBe('D2Coding, "MCW Noto Sans KR"');
    expect(withKoreanFallback('"MCW Noto Sans KR", monospace')).toBe('"MCW Noto Sans KR", monospace');
  });
});
