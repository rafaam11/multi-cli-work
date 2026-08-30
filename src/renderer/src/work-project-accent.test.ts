import { describe, expect, it } from "vitest";
import { WORK_PROJECT_CATEGORIES } from "@shared/work-project-types";
import { categoryAccentClass, channelAccentClass, isWorkProjectDormant } from "./work-project-accent";

describe("categoryAccentClass", () => {
  it("gives each suggested category its own colour class", () => {
    expect(categoryAccentClass("정부지원과제")).toBe("category-government");
    expect(categoryAccentClass("외주개발")).toBe("category-outsourcing");
    expect(categoryAccentClass("연구")).toBe("category-research");
    expect(categoryAccentClass("상품개발")).toBe("category-product");
    expect(categoryAccentClass("기타")).toBe("category-etc");
  });

  it("covers every suggested category, so adding one to the shared list cannot go unnoticed", () => {
    const classes = WORK_PROJECT_CATEGORIES.map(categoryAccentClass);
    expect(new Set(classes).size).toBe(WORK_PROJECT_CATEGORIES.length);
  });

  it("falls back to 기타 for a legacy or custom category", () => {
    expect(categoryAccentClass("사내연구")).toBe("category-etc");
    expect(categoryAccentClass("")).toBe("category-etc");
  });

  it("tolerates surrounding whitespace, which the 구분 field does not trim", () => {
    expect(categoryAccentClass("  외주개발 ")).toBe("category-outsourcing");
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

describe("channelAccentClass", () => {
  it("gives each ws-root channel letter its own colour class", () => {
    expect(channelAccentClass("G")).toBe("channel-grant");
    expect(channelAccentClass("O")).toBe("channel-service");
    expect(channelAccentClass("R")).toBe("channel-research");
    expect(channelAccentClass("P")).toBe("channel-personal");
    expect(channelAccentClass("Z")).toBe("channel-etc");
    expect(new Set(["G", "O", "R", "P", "Z"].map(channelAccentClass)).size).toBe(5);
  });

  it("falls back to 기타 for a letter outside the vocabulary", () => {
    expect(channelAccentClass("X")).toBe("channel-etc");
    expect(channelAccentClass("")).toBe("channel-etc");
  });

  it("tolerates case and whitespace, which a hand-edited channel folder can carry", () => {
    expect(channelAccentClass(" o ")).toBe("channel-service");
  });
});
