import { describe, expect, it } from "vitest";
import { TAG_ACCENT_COUNT, tagAccentClass, tagAccentIndex } from "./tag-color";

describe("tagAccentClass", () => {
  // 해시가 바뀌면 태그 색이 화면마다 흔들린다 — 고정 입력의 결과를 하드코딩해 회귀를 잡는다.
  it("고정 입력 3개는 정해진 accent 클래스로 고정된다", () => {
    expect(tagAccentClass("개인")).toBe("accent-2");
    expect(tagAccentClass("AI")).toBe("accent-3");
    expect(tagAccentClass("연구")).toBe("accent-2");
  });

  it("같은 입력은 항상 같은 클래스를 반환한다", () => {
    expect(tagAccentClass("반복")).toBe(tagAccentClass("반복"));
  });

  it("임의의 태그 100개는 전부 accent-1..accent-7 범위에 든다", () => {
    for (let i = 0; i < 100; i++) {
      const tag = `tag-${i}-${Math.random().toString(36).slice(2)}`;
      const index = tagAccentIndex(tag);
      expect(index).toBeGreaterThanOrEqual(1);
      expect(index).toBeLessThanOrEqual(TAG_ACCENT_COUNT);
      expect(tagAccentClass(tag)).toBe(`accent-${index}`);
    }
  });

  it("앞뒤 공백은 무시한다", () => {
    expect(tagAccentClass(" AI ")).toBe(tagAccentClass("AI"));
    expect(tagAccentClass("\t개인\n")).toBe(tagAccentClass("개인"));
  });

  it("한국어 태그 8개는 5종 이상의 클래스로 흩어진다", () => {
    const tags = ["개인", "회사", "대학원", "연구실", "AI", "로보틱스", "재무", "건강"];
    const classes = new Set(tags.map((tag) => tagAccentClass(tag)));
    expect(classes.size).toBeGreaterThanOrEqual(5);
  });
});
