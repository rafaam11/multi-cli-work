import { DEFAULT_PROJECT_CATEGORIES } from "@shared/settings-types";
import { describe, expect, it } from "vitest";
import { categoryAccentClass, isWorkProjectDormant } from "./work-project-accent";

describe("categoryAccentClass", () => {
  it("maps a category in the settings list onto its palette class", () => {
    expect(categoryAccentClass("업무", DEFAULT_PROJECT_CATEGORIES)).toBe("accent-1");
    expect(categoryAccentClass("개인", DEFAULT_PROJECT_CATEGORIES)).toBe("accent-4");
    expect(categoryAccentClass("연구", DEFAULT_PROJECT_CATEGORIES)).toBe("accent-3");
    expect(categoryAccentClass("기타", DEFAULT_PROJECT_CATEGORIES)).toBe("accent-5");
  });

  it("gives every default category its own class, so the defaults stay distinguishable", () => {
    const classes = DEFAULT_PROJECT_CATEGORIES.map((category) =>
      categoryAccentClass(category.name, DEFAULT_PROJECT_CATEGORIES),
    );
    expect(new Set(classes).size).toBe(DEFAULT_PROJECT_CATEGORIES.length);
  });

  it("falls back to grey for a value the list does not know — legacy names included", () => {
    expect(categoryAccentClass("정부지원과제", DEFAULT_PROJECT_CATEGORIES)).toBe("category-etc");
    expect(categoryAccentClass("사내연구", DEFAULT_PROJECT_CATEGORIES)).toBe("category-etc");
    expect(categoryAccentClass("", DEFAULT_PROJECT_CATEGORIES)).toBe("category-etc");
  });

  it("tolerates surrounding whitespace, which the 구분 field does not trim", () => {
    expect(categoryAccentClass("  개인 ", DEFAULT_PROJECT_CATEGORIES)).toBe("accent-4");
  });

  it("reads the colour off the list rather than the name", () => {
    expect(categoryAccentClass("업무", [{ name: "업무", color: 6 }])).toBe("accent-6");
  });

  it("is grey across the board when the list is empty", () => {
    expect(categoryAccentClass("업무", [])).toBe("category-etc");
  });
});

describe("isWorkProjectDormant", () => {
  it("dims finished and archived work", () => {
    expect(isWorkProjectDormant("완료")).toBe(true);
    expect(isWorkProjectDormant("보관")).toBe(true);
  });

  it("leaves live work and unset status at full strength", () => {
    expect(isWorkProjectDormant("진행중")).toBe(false);
    expect(isWorkProjectDormant("보류")).toBe(false);
    expect(isWorkProjectDormant(null)).toBe(false);
  });
});
